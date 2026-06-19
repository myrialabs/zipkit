/**
 * Ambient declaration for the Emscripten-emitted engine module
 * (`engine/dist/zipkit-engine.mjs`). The factory is the module's default
 * export; calling it returns a Promise that resolves to the instantiated
 * Wasm module. We keep the resolved shape as `any` here — {@link ZipKitEngine}
 * narrows it to a typed interface.
 */
declare module '*.mjs' {
	const factory: (moduleArg?: Record<string, unknown>) => Promise<any>;
	export default factory;
}
