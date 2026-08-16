import { useTheme } from "../context/theme"

export function PluginRouteMissing(props: { id: string; onHome: () => void }) {
  const { theme } = useTheme()

  return (
    <box width="100%" height="100%" alignItems="center" justifyContent="center" flexDirection="column" gap={1}>
      <text fg={theme.status.warning.fg}>Unknown plugin route: {props.id}</text>
      <box onMouseUp={props.onHome} backgroundColor={theme.surface.offset} paddingLeft={1} paddingRight={1}>
        <text fg={theme.foreground.default}>go home</text>
      </box>
    </box>
  )
}
