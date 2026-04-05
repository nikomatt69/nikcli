export function Loading(props: { message?: string }) {
  return (
    <div class="page-loading">
      <div class="spinner" />
      {props.message ?? "Loading..."}
    </div>
  )
}

export function PageError(props: { message: string }) {
  return <div class="page-error">{props.message}</div>
}
