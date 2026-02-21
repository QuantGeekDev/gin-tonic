import { type Logger } from "pino";
export interface JihnLoggerOptions {
    name: string;
    level?: string;
    base?: Record<string, unknown> | null;
}
export declare function createJihnLogger(options: JihnLoggerOptions): Logger;
//# sourceMappingURL=logger.d.ts.map