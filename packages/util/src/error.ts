import z from "zod"

export abstract class NamedError extends Error {
  abstract schema(): z.core.$ZodType
  abstract toObject(): { name: string; data: any }

  static create<Name extends string, Data extends z.core.$ZodType>(name: Name, data: Data) {
    const schema = z
      .object({
        name: z.literal(name),
        data,
      })
      .meta({
        ref: name,
      })
    const result = class extends NamedError {
      public static readonly Schema = schema

      public override readonly name = name as Name

      constructor(
        public readonly data: z.input<Data>,
        options?: ErrorOptions,
      ) {
        super(name, options)
        this.name = name
      }

      static isInstance(input: any): input is InstanceType<typeof result> {
        return typeof input === "object" && "name" in input && input.name === name
      }

      schema() {
        return schema
      }

      toObject() {
        return {
          name: name,
          data: this.data,
        }
      }
    }
    Object.defineProperty(result, "name", { value: name })
    return result
  }

  public static readonly Unknown = NamedError.create(
    "UnknownError",
    z.object({
      message: z.string(),
    }),
  )
}

export class RejectedPermissionError extends Error {
  constructor(
    public readonly sessionID: string,
    public readonly permissionID: string,
    public readonly toolCallID?: string,
    public readonly metadata?: Record<string, any>,
    public readonly reason?: string,
  ) {
    super(
      reason !== undefined
        ? reason
        : `The user rejected permission to use this specific tool call. You may try again with different parameters.`,
    )
  }
}

export class RejectedQuestionError extends Error {
  constructor() {
    super("The user dismissed this question")
  }
}

export class RejectedDBEditError extends Error {
  constructor(message?: string) {
    super(
      message
        ? `The user rejected database changes with feedback: ${message}`
        : `The user rejected the database changes.`,
    )
  }
}

export class RejectedToolCallError extends Error {
  constructor() {
    super(`The user rejected permission to use this specific tool call.`)
  }
}

export class CorrectedToolCallError extends Error {
  constructor(message: string) {
    super(`The user rejected permission to use this specific tool call with the following feedback: ${message}`)
  }
}

export class DeniedToolCallError extends Error {
  constructor(public readonly ruleset: unknown[]) {
    super(
      `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(ruleset)}`,
    )
  }
}
