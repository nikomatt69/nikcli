import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

function runTodo<A, E>(effect: Effect.Effect<A, E, Todo.Service>) {
  return runPromiseWithLayer(Todo.defaultLayer, withCurrentInstance(effect))
}

export const TodoWriteTool = Tool.define("todowrite", {
  description: DESCRIPTION_WRITE,
  parameters: z.object({
    todos: z.array(z.object(Todo.Info.shape)).describe("The updated todo list"),
  }),
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
          todos: params.todos,
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
  parameters: z.object({}),
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
