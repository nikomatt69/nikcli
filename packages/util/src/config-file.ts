import path from "path"

/**
 * The two filenames a config document may take, in precedence order.
 *
 * Extracted from `ConfigPaths` so the plugin installer can spell them without
 * importing the config service — the rest of that module needs the Effect
 * runtime, and this is two joins. `ConfigPaths.fileInDirectory` delegates here,
 * so there is one definition of what a config file is called.
 */
export function configFilesInDirectory(dir: string, name: string): [string, string] {
  return [path.join(dir, `${name}.jsonc`), path.join(dir, `${name}.json`)]
}
