import { spawn } from "node:child_process";

function pipeToClipboard(command: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (process.platform === "darwin") {
    return pipeToClipboard("pbcopy", [], text);
  }
  if (process.platform === "linux") {
    const xclip = await pipeToClipboard("xclip", ["-selection", "clipboard"], text);
    if (xclip) return true;
    return pipeToClipboard("xsel", ["--clipboard", "--input"], text);
  }
  return false;
}
