import { useEffect, useRef, useState } from "react"
import { AppState, Pressable, Text, View } from "react-native"
import { useServer } from "@/lib/server-provider"

export function NetworkBanner() {
  const { client, config } = useServer()
  const [isReachable, setIsReachable] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function checkReachability() {
    if (!client) return
    const ok = await client.ping()
    setIsReachable(ok)
  }

  useEffect(() => {
    if (!config) return

    void checkReachability()

    intervalRef.current = setInterval(() => {
      void checkReachability()
    }, 30_000)

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkReachability()
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      subscription.remove()
    }
  }, [client, config])

  if (!config || isReachable) return null

  return (
    <View className="flex-row items-center justify-between gap-3 bg-danger/10 px-4 py-2.5">
      <View className="flex-row items-center gap-2">
        <View className="h-2 w-2 rounded-full bg-danger" />
        <Text className="text-sm font-medium text-danger">Server unreachable</Text>
      </View>
      <Pressable onPress={() => void checkReachability()}>
        <Text className="text-sm font-semibold text-danger">Retry</Text>
      </Pressable>
    </View>
  )
}
