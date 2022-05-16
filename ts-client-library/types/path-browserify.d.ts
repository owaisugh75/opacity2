declare module "path-browserify" {
	import path, {
		FormatInputPathObject,
		ParsedPath,
		basename,
		delimiter,
		dirname,
		extname,
		format,
		isAbsolute,
		join,
		normalize,
		parse,
		posix,
		relative,
		resolve,
		sep,
	} from "path"
	export default path
	export {
		FormatInputPathObject,
		ParsedPath,
		basename,
		delimiter,
		dirname,
		extname,
		format,
		isAbsolute,
		join,
		normalize,
		parse,
		posix,
		relative,
		resolve,
		sep,
	}
}
