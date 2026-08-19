/**
 * Expected 4xx failure from a typed mobile route function. The HttpApi handler
 * maps these onto the endpoint's declared error schemas (`{ name, error }`,
 * status by `httpApiStatus`); any other thrown value is a defect and answers
 * 500, exactly as it did when the dispatcher served the route raw.
 */
export class MobileHttpError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 404,
  ) {
    super(message)
    this.name = "MobileHttpError"
  }
}

export function proxyResponse(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  })
}
