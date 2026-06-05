module.exports = function (api) {
  api.cache(true)
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }]],
    plugins: [
      [
        "module-resolver",
        {
          root: ["./"],
          alias: {
            "@": "./",
          },
          extensions: [".ts", ".tsx", ".js", ".jsx"],
        },
      ],
      // react-native-reanimated/plugin MUST be the last plugin in the list.
      // It transforms worklets and requires every other plugin to run first.
      "react-native-reanimated/plugin",
    ],
  }
}
