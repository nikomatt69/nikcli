import { Effect, Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

function runTodo<A, E>(effect: Effect.Effect<A, E, Todo.Service>) {
  return runPromiseWithLayer(Todo.defaultLayer, withCurrentInstance(effect))
}

const ReadParameters = Schema.Struct({})

const TodoItem = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
  id: Schema.String.annotate({ description: "Unique identifier for the todo item" }),
})

const WriteParameters = Schema.Struct({
  todos: Schema.Array(TodoItem).annotate({ description: "The updated todo list" }),
})

export const TodoWriteTool = Tool.define("todowrite", {
  description: DESCRIPTION_WRITE,
  parameters: zod(WriteParameters),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "todowrite",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    await runTodo(
      Effect.gen(function* () {
        const todo = yield* Todo.Service
        yield* todo.update({
          sessionID: ctx.sessionID,
          todos: [...params.todos],
        })
      }),
    )
    return {
      title: `${params.todos.filter((x) => x.status !== "completed").length} todos`,
      output: JSON.stringify(params.todos, null, 2),
      metadata: {
        todos: params.todos,
      },
    }
  },
})

export const TodoReadTool = Tool.define("todoread", {
  description: "Use this tool to read your todo list",
  parameters: zod(ReadParameters),
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "todoread",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const todos = await runTodo(
      Effect.gen(function* () {
        const todo = yield* Todo.Service
        return yield* todo.get(ctx.sessionID)
      }),
    )
    return {
      title: `${todos.filter((x) => x.status !== "completed").length} todos`,
      metadata: {
        todos,
      },
      output: JSON.stringify(todos, null, 2),
    }
  },
})
