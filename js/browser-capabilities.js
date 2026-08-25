export function supportsDirectoryPicker(environment = globalThis) {
  return typeof environment?.showDirectoryPicker === "function";
}

export function supportsOpenFilePicker(environment = globalThis) {
  return typeof environment?.showOpenFilePicker === "function";
}

export function supportsDirectoryIteration(directoryHandle) {
  return typeof directoryHandle?.entries === "function";
}

export function supportsOrdinaryImageFileFallback(environment = globalThis) {
  return typeof environment?.document?.createElement === "function" &&
    typeof environment?.FileReader === "function";
}
