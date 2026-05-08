import { Hono } from "hono"
import { validator } from "hono-openapi"
import z from "zod"
import { UserDB } from "@/db/users"
import { Schema } from "effect"
import { zodObject, zodObjectMode, zodOverride } from "@/util/effect-zod"

const strip = zodObjectMode("strip")
const EmailSchema = Schema.String.annotations(zodOverride(() => z.string().email()))
const RegistrationPasswordSchema = Schema.String.annotations(
  zodOverride(() =>
    z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
  ),
)
const UpdatePasswordSchema = Schema.String.annotations(zodOverride(() => z.string().min(8)))
const RegisterInput = zodObject(
  Schema.Struct({
    username: Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64)),
    email: EmailSchema,
    password: RegistrationPasswordSchema,
    displayName: Schema.optional(Schema.String.pipe(Schema.maxLength(128))),
  }).annotations(strip),
)
const LoginInput = zodObject(
  Schema.Struct({
    email: EmailSchema,
    password: Schema.String,
  }).annotations(strip),
)
const UpdateUserInput = zodObject(
  Schema.Struct({
    displayName: Schema.optional(Schema.String.pipe(Schema.maxLength(128))),
    password: Schema.optional(UpdatePasswordSchema),
    role: Schema.optional(Schema.Literal("admin", "user")),
  }).annotations(strip),
)

declare module "hono" {
  interface ContextVariableMap {
    userSession: { user: UserDB.PublicUser; token: string } | undefined
  }
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization") || req.headers.get("Authorization")
  if (!header) return
  const [scheme, value] = header.split(/\s+/, 2)
  if (!scheme || !value) return
  if (scheme.toLowerCase() !== "bearer") return
  const v = value.trim()
  if (!v.startsWith("nku_")) return
  return v
}

export function userAuthMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    const token = bearerToken(c.req.raw)
    if (token) {
      const user = UserDB.verifySession(token)
      if (user) {
        c.set("userSession", { user, token })
      }
    }
    await next()
  }
}

function requireUser(c: any): { user: UserDB.PublicUser; token: string } | null {
  return c.get("userSession") ?? null
}

function requireAdmin(c: any): boolean {
  const session = c.get("userSession")
  return session?.user.role === "admin"
}

export function UserRoutes() {
  const app = new Hono()

  // POST /user/register
  app.post(
    "/register",
    validator(
      "json",
      RegisterInput,
    ),
    async (c) => {
      const body = c.req.valid("json")

      // Only allow registration if: no users exist OR caller is admin
      const hasUsers = UserDB.hasUsers()
      if (hasUsers) {
        const session = requireUser(c)
        if (!session || session.user.role !== "admin") {
          return c.json({ error: "Only admins can create new users" }, 403)
        }
      }

      // Check duplicate email
      const existing = UserDB.findByEmail(body.email)
      if (existing) return c.json({ error: "Email already in use" }, 409)

      try {
        const user = await UserDB.create({
          username: body.username,
          email: body.email,
          password: body.password,
          displayName: body.displayName,
        })
        const token = UserDB.createSession(user.id, 30)
        return c.json({ token, user }, 201)
      } catch (err: any) {
        if (err?.message?.includes("UNIQUE")) {
          return c.json({ error: "Username or email already in use" }, 409)
        }
        if (err?.message?.includes("not authorized")) {
          return c.json({ error: err.message }, 403)
        }
        throw err
      }
    },
  )

  // POST /user/login
  app.post(
    "/login",
    validator(
      "json",
      LoginInput,
    ),
    async (c) => {
      const { email, password } = c.req.valid("json")
      const user = UserDB.findByEmail(email)
      if (!user) return c.json({ error: "Invalid credentials" }, 401)

      const valid = await UserDB.verifyPassword(user, password)
      if (!valid) return c.json({ error: "Invalid credentials" }, 401)

      const token = UserDB.createSession(user.id, 30)
      return c.json({ token, user: UserDB.toPublic(user) })
    },
  )

  // POST /user/logout
  app.post("/logout", async (c) => {
    const session = requireUser(c)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    UserDB.revokeSession(session.token)
    return c.json({ ok: true })
  })

  // GET /user/me
  app.get("/me", async (c) => {
    const session = requireUser(c)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    return c.json(session.user)
  })

  // GET /user/status — public, tells client whether users exist
  app.get("/status", async (c) => {
    return c.json({ hasUsers: UserDB.hasUsers() })
  })

  // GET /user/list — admin only
  app.get("/list", async (c) => {
    const session = requireUser(c)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    if (!requireAdmin(c)) return c.json({ error: "Forbidden" }, 403)
    return c.json(UserDB.listUsers())
  })

  // PATCH /user/:id — admin or self
  app.patch(
    "/:id",
    validator(
      "json",
      UpdateUserInput,
    ),
    async (c) => {
      const session = requireUser(c)
      if (!session) return c.json({ error: "Unauthorized" }, 401)

      const { id } = c.req.param()
      const isSelf = session.user.id === id
      const isAdmin = session.user.role === "admin"

      if (!isSelf && !isAdmin) return c.json({ error: "Forbidden" }, 403)

      // Only admin can change roles
      const body = c.req.valid("json")
      if (body.role && !isAdmin) return c.json({ error: "Only admins can change roles" }, 403)

      // Enforce admin email allowlist
      if (body.role === "admin") {
        const targetUser = UserDB.findById(id)
        if (!targetUser) return c.json({ error: "User not found" }, 404)
        if (!UserDB.isAdminEmail(targetUser.email)) {
          return c.json({ error: "This email address is not authorized to hold the admin role" }, 403)
        }
      }

      try {
        const updated = await UserDB.updateUser(id, body)
        if (!updated) return c.json({ error: "User not found" }, 404)
        return c.json(updated)
      } catch (err: any) {
        if (err?.message?.includes("not authorized")) {
          return c.json({ error: err.message }, 403)
        }
        throw err
      }
    },
  )

  // DELETE /user/:id — admin only
  app.delete("/:id", async (c) => {
    const session = requireUser(c)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    if (!requireAdmin(c)) return c.json({ error: "Forbidden" }, 403)

    const { id } = c.req.param()
    if (id === session.user.id) return c.json({ error: "Cannot delete yourself" }, 400)

    const deleted = UserDB.deleteUser(id)
    if (!deleted) return c.json({ error: "User not found" }, 404)
    return c.json({ ok: true })
  })

  return app
}
