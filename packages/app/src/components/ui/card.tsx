import { splitProps, type JSX } from "solid-js"
import { cn } from "../../lib/utils"

interface CardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  children: JSX.Element
}

export function Card(props: CardProps) {
  const [local, rest] = splitProps(props, ["children", "class"])

  return (
    <div
      class={cn("rounded-xl border bg-white dark:bg-gray-900 dark:border-gray-800 shadow-sm", local.class)}
      {...rest}
    >
      {local.children}
    </div>
  )
}

interface CardHeaderProps extends JSX.HTMLAttributes<HTMLDivElement> {
  children: JSX.Element
}

export function CardHeader(props: CardHeaderProps) {
  const [local, rest] = splitProps(props, ["children", "class"])

  return (
    <div class={cn("flex flex-col space-y-1.5 p-6", local.class)} {...rest}>
      {local.children}
    </div>
  )
}

interface CardTitleProps extends JSX.HTMLAttributes<HTMLHeadingElement> {
  children: JSX.Element
}

export function CardTitle(props: CardTitleProps) {
  const [local, rest] = splitProps(props, ["children", "class"])

  return (
    <h3 class={cn("text-2xl font-semibold leading-none tracking-tight", local.class)} {...rest}>
      {local.children}
    </h3>
  )
}

interface CardDescriptionProps extends JSX.HTMLAttributes<HTMLParagraphElement> {
  children: JSX.Element
}

export function CardDescription(props: CardDescriptionProps) {
  const [local, rest] = splitProps(props, ["children", "class"])

  return (
    <p class={cn("text-sm text-gray-500 dark:text-gray-400", local.class)} {...rest}>
      {local.children}
    </p>
  )
}

interface CardContentProps extends JSX.HTMLAttributes<HTMLDivElement> {
  children: JSX.Element
}

export function CardContent(props: CardContentProps) {
  const [local, rest] = splitProps(props, ["children", "class"])

  return (
    <div class={cn("p-6 pt-0", local.class)} {...rest}>
      {local.children}
    </div>
  )
}

interface CardFooterProps extends JSX.HTMLAttributes<HTMLDivElement> {
  children: JSX.Element
}

export function CardFooter(props: CardFooterProps) {
  const [local, rest] = splitProps(props, ["children", "class"])

  return (
    <div class={cn("flex items-center p-6 pt-0", local.class)} {...rest}>
      {local.children}
    </div>
  )
}
