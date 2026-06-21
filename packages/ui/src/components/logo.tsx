import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        data-slot="logo-logo-mark-shadow"
        d="M4 8H8V12H4ZM8 8H12V12H8ZM4 12H8V16H4ZM8 12H12V16H8ZM4 16H8V20H4ZM8 16H12V20H8Z"
        fill="var(--icon-weak-base)"
      />
      <path
        data-slot="logo-logo-mark-n"
        d="M0 0H4V4H0ZM4 0H8V4H4ZM8 0H12V4H8ZM0 4H4V8H0ZM12 4H16V8H12ZM0 8H4V12H0ZM12 8H16V12H12ZM0 12H4V16H0ZM12 12H16V16H12ZM0 16H4V20H0ZM12 16H16V20H12Z"
        fill="var(--icon-strong-base)"
      />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20 40H40V60H20ZM40 40H60V60H40ZM20 60H40V80H20ZM40 60H60V80H40ZM20 80H40V100H20ZM40 80H60V100H40Z"
        fill="var(--icon-base)"
      />
      <path
        d="M0 0H20V20H0ZM20 0H40V20H20ZM40 0H60V20H40ZM0 20H20V40H0ZM60 20H80V40H60ZM0 40H20V60H0ZM60 40H80V60H60ZM0 60H20V80H0ZM60 60H80V80H60ZM0 80H20V100H0ZM60 80H80V100H60Z"
        fill="var(--icon-strong-base)"
      />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 174 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <path
          data-slot="logo-shadow"
          d="M6 18H12V24H6ZM12 18H18V24H12ZM6 24H12V30H6ZM12 24H18V30H12ZM6 30H12V36H6ZM12 30H18V36H12ZM96 18H102V24H96ZM102 18H108V24H102ZM108 18H114V24H108ZM96 24H102V30H96ZM102 24H108V30H102ZM108 24H114V30H108ZM126 18H132V24H126ZM126 24H132V30H126Z"
          fill="var(--icon-weak-base)"
        />
        <path
          data-slot="logo-nik"
          d="M0 6H6V12H0ZM6 6H12V12H6ZM12 6H18V12H12ZM0 12H6V18H0ZM18 12H24V18H18ZM0 18H6V24H0ZM18 18H24V24H18ZM0 24H6V30H0ZM18 24H24V30H18ZM0 30H6V36H0ZM18 30H24V36H18ZM30 6H36V12H30ZM36 6H42V12H36ZM42 6H48V12H42ZM36 12H42V18H36ZM36 18H42V24H36ZM36 24H42V30H36ZM30 30H36V36H30ZM36 30H42V36H36ZM42 30H48V36H42ZM60 6H66V12H60ZM78 6H84V12H78ZM60 12H66V18H60ZM72 12H78V18H72ZM60 18H66V24H60ZM66 18H72V24H66ZM60 24H66V30H60ZM72 24H78V30H72ZM60 30H66V36H60ZM78 30H84V36H78Z"
          fill="var(--icon-base)"
        />
        <path
          data-slot="logo-cli"
          d="M90 6H96V12H90ZM96 6H102V12H96ZM102 6H108V12H102ZM108 6H114V12H108ZM90 12H96V18H90ZM90 18H96V24H90ZM90 24H96V30H90ZM90 30H96V36H90ZM96 30H102V36H96ZM102 30H108V36H102ZM108 30H114V36H108ZM120 6H126V12H120ZM120 12H126V18H120ZM120 18H126V24H120ZM120 24H126V30H120ZM120 30H126V36H120ZM126 30H132V36H126ZM132 30H138V36H132ZM138 30H144V36H138ZM150 6H156V12H150ZM156 6H162V12H156ZM162 6H168V12H162ZM156 12H162V18H156ZM156 18H162V24H156ZM156 24H162V30H156ZM150 30H156V36H150ZM156 30H162V36H156ZM162 30H168V36H162Z"
          fill="var(--icon-strong-base)"
        />
      </g>
    </svg>
  )
}
