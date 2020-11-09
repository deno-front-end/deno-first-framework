import { path } from "../../../deps.ts";
import { ModuleErrors } from "../ModuleErrors.ts";

interface EonSandBoxDocument {
  /**
   * the content of the document in the original folder
   */
  content: string;
  /**
   * the transpiled content of the jsx/tsx file
   * this is to speed up the check step
   */
  transpiled: string;
  /**
   * the rendered module, fetched via a dynamic import
   */
  module?: any;
  /**
   * the path of the document in the sandBox
   */
  sandBoxPath: string;
  /**
   * the js path of the document in the sandBox
   */
  importable: string;
  /**
   * the original path of the document
   */
  sourcePath: string;
};
/**
 * class to build parallel folder
 * the goal is to render all the modules in one time
 * using transpileOnly to transform the module before fetching it
 */

export default class EonSandBoxFileSystem {
  protected static paths: string[] = [];
  protected static readonly mapFiles: Map<string, EonSandBoxDocument> = new Map();
  protected static readonly currentLocation: string = Deno.cwd();
  protected static readonly removeOptions = { recursive: true };
  public static readonly sandBoxLocation: string = path.join(Deno.cwd(), `../.eon`);
  static async saveSandBoxedFile(opts: { path: string; sandBoxPath: string; importable: string }): Promise<void> {
    const { path: pathToFile, sandBoxPath, importable } = opts;
    const content = Deno.readTextFileSync(pathToFile);
    const jsxFileContent = await this.getTranspiledFile({
      sandBoxPath,
      content,
    });
    // save the new file in the sandbox
    Deno.writeTextFileSync(sandBoxPath, jsxFileContent);
    this.mapFiles.set(pathToFile, {
      sandBoxPath,
      content,
      transpiled: jsxFileContent,
      importable,
      sourcePath: pathToFile,
      module: undefined,
    });
    // save it's equivalent js file
    Deno.writeTextFileSync(importable, jsxFileContent);
  }
  /**
   * add a tsconfig file to the session
   */
  protected static addTsConfig() {
    this.addFile('/tsconfig.json', JSON.stringify({
      compilerOptions: {
        jsxFactory: "h",
        jsxFragmentFactory: "hf",
        jsx: "react"
      },
    }, null, 2))
  }
  /**
   * add a file to the session
   */
  static addFile(p: string, text: string) {
    try {
      const sandBoxPath = path.join(this.sandBoxLocation, p);
      Deno.writeTextFileSync(sandBoxPath, text);
      this.paths.push(sandBoxPath);
    } catch (err) {
      throw err;
    }
  }
  static isJSXFile(p: string) {
    return /\.(tsx|jsx)$/.test(p);
  }
  /**
   * erase the Deno.cwd() from a path
   * and returns the matching location in the sandBox with it's equivalent js file
   */
  static getSandBoxMirrorPath(p: string): { importable: string; source: string } {
    const sourcePath = p.replace(this.currentLocation, '');
    const sandBoxPath = path.join(this.sandBoxLocation, sourcePath);
    return {
      importable: sandBoxPath.match(/\.(tsx|jsx)$/) ? `${sandBoxPath}.js` : sandBoxPath,
      source: sandBoxPath,
    };
  }
  /**
   * returns the matching module from the sandbox
   */
  static async getSandBoxMirrorModule(p: string) {
    const { importable } = this.getSandBoxMirrorPath(p);
    const module = await import(importable);
    return module;
  }
  /**
   * takes a source path and a sandBox Path as argument,
   * injects h and hf functions as dependencies for jsxFactory
   */
  static async getTranspiledFile(opts: {
    content: string;
    sandBoxPath: string
  }): Promise<string> {
    const { sandBoxPath, content } = opts;
    const hPath = new URL('../../functions/jsxFactory.ts', import.meta.url).toString();
    const newJSX = await Deno.transpileOnly({
      [sandBoxPath]: `// @ts-nocheck
        import { h, hf } from '${hPath}';
        ${content}`
    }, {
      jsxFactory: 'h',
      /** @ts-ignore */
      jsxFragmentFactory: 'hf',
      jsx: 'react',
      sourceMap: false,
    });
    return newJSX[sandBoxPath].source;
  }
  /**
   * type checking step for all components
   */
  static async typecheckSession(): Promise<void> {
    let diagnostics: unknown[] = []
    let documents = Array.from(this.mapFiles.entries()).map(([, document]) => document);
    for await( let document of documents) {
      if (document) {
        const [diags] = await Deno.compile(document.sourcePath, undefined, {
          jsxFactory: 'h',
          /** @ts-ignore */
          jsxFragmentFactory: 'hf',
          jsx: 'react',
          types: [new URL('/types.d.ts', import.meta.url).toString()],
          sourceMap: false,
        });
        //  TODO typecheck props usages
        if (diags) {
          diagnostics = [
            ...diagnostics,
            ...diags
          ];
        }
      }
    }
    // start reporting type errors
    // throws if defined
    ModuleErrors.checkDiagnostics(diagnostics as unknown[]);
  }
}