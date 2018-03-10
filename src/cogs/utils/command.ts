import { stripEmptyChars, escapeRegExp } from "./text";

export const CMDPARSER_ARGUMENTS_SEPARATOR = ",";

export function parse(str: string, argsSeparator = CMDPARSER_ARGUMENTS_SEPARATOR): ICommandParseResult {
	const parts = str.split(" ");

	const cmd = parts.shift();
	const subCmd = parts.shift() || null; // subcmd / null

	let args: ICommandParseResultArg[] | null = null;

	if(parts.length > 0) {
		args = [];
		const cmdStr = `${cmd}${subCmd != null ? ` ${subCmd} ` : " "}`;
		const argsStr = str.substring(cmdStr.length);

		for(const arg of argumentSplit(argsStr, argsSeparator)) {
			args.push({
				raw: arg,
				value: stripEmptyChars(arg).trim()
			});
		}
	}

	return {
		command: cmd!, // command can't be empty
		subCommand: subCmd,
		args: args ? argsGenerator(args) : null
	};
}

export function argsGenerator(args: ICommandParseResultArg[]): ICommandParseResultArgs {
	const normal: string[] = [];
	const raw: string[] = [];

	for(const arg of args) {
		if(arg.value.length > 0) {
			normal.push(arg.value);
		}
		raw.push(arg.raw);
	}

	// tslint:disable-next-line:prefer-object-spread
	return Object.assign(args, {
		only: (type: "value" | "raw") => (type === "value" ? normal : raw).slice()
	});
}

export function argumentSplit(argStr: string, separator = ",") {
	if(separator.length === 0) {
		throw new Error("`separator` can't be empty string");
	}

	const args: string[] = [];

	separator = escapeRegExp(separator);

	// \\ for separator escape, in Discord would look like "hello\, world!" ("hello\\, world!")
	const separatorRegexp = RegExp(`(?<=(^|[^\\\\]))${separator}`);

	let nPos = 0;
	while(nPos !== -1) {
		argStr = argStr.substr(nPos);

		const separatorMatch = separatorRegexp.exec(argStr);

		let curArgEndPos: null | number = null;
		if(separatorMatch) {
			nPos = separatorMatch.index + separatorMatch[0].length;
			curArgEndPos = separatorMatch.index;
		} else { nPos = -1; }

		args.push(argStr.substring(0, curArgEndPos === null ? undefined : curArgEndPos));
	}

	return args;
}

export interface ICommandParseResult {
	command: string;
	subCommand: string | null;
	args: ICommandParseResultArgs | null;
}

export interface ICommandParseResultArgs extends Array<ICommandParseResultArg> {
	only(type: "value" | "raw"): string[];
}

export interface ICommandParseResultArg {
	value: string;
	raw: string;
}
