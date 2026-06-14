// Ambient declaration for CSS side-effect imports (e.g. `import "@/global.css"`).
// NativeWind v4.2+ no longer ships a `*.css` module declaration via
// `nativewind/types`, so side-effect CSS imports otherwise fail typecheck
// with TS2882 ("Cannot find module or type declarations for side-effect import").
declare module "*.css";
