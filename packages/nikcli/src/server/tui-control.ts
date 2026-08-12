import { AsyncQueue } from "@/util/queue"

export type TuiControlRequest = {
  readonly path: string
  readonly body: unknown
}

const request = new AsyncQueue<TuiControlRequest>()
const response = new AsyncQueue<unknown>()

export const TuiControlQueues = { request, response }
