import { Hono } from "hono"

const app = new Hono()

app.get("/", (c) => c.text("Auth API"))

export default app
