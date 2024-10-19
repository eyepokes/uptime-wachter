import numeral from 'numeral';
import config from './config';
import cp from 'child_process';
import { readFile, stat } from 'fs/promises';
import { RemoveProperty } from './types';
import { FinishedTracerouteTestResult } from 'globalping-ts/dist/types';
import { DateTime } from 'luxon';
import * as fs from 'fs';
import path from 'path';

export function log(message: string, level: number = 0) {
    const appName = config.APP_NAME;
    let logLevel = parseInt(config.LOG_LEVEL ?? '1');
    //const logFilePath = path.resolve(config.LOGS_PATH) || 'app.log';
    const timezone = config.TIMEZONE || 'UTC';

    if (level >= logLevel) {
        const timestamp = DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd HH:mm:ss ZZZZ');
        //const logMessage = `${timestamp} :: ${appName} :: ${message} (${memoryUsage()})`;
        const logMessage = `${appName} :: ${message} (${memoryUsage()})`;

        console.log(logMessage);

        /*fs.appendFileSync(path.resolve(logFilePath), logMessage + '\n');*/
    }
}

export function memoryUsage() {
    let memory = process.memoryUsage();
    return numeral(memory.rss).format('0.00b');
}

export async function createWorker(path: string, data: any, config: { [K: string]: string }) {
    return new Promise(async (resolve, reject) => {
        try {
            let check = await file_exists(path);

            if (!check) {
                reject(new Error(`worker filepath: ${path} is not found`));
            } else {
                let worker = cp.fork(path, { env: config });

                worker.send(data);

                worker.on('exit', (code: number) => {
                    if (code === 0) {
                        resolve(0);
                        return;
                    }
                    reject(new Error(`worker exited with code: ${code}`));
                });

                worker.on('message', async (message: any) => {
                    worker.disconnect();
                    resolve(message);
                });
            }
        } catch (e: any) {
            reject(e);
        }
    });
}

export async function file_exists(filePath: string) {
    try {
        await stat(filePath);
        return true;
    } catch (error: any) {
        return false;
    }
}

export async function loadJSON(path: string): Promise<any> {
    let source = await readFile(path, { encoding: 'utf-8' });
    return JSON.parse(source);
}

export function removeProperty<T, K extends keyof T>(obj: T, key: K): RemoveProperty<T, K> {
    const { [key]: _, ...rest } = obj;
    return rest as RemoveProperty<T, K>;
}

export function calculateAverageRTT(input: FinishedTracerouteTestResult): number {
    let totalRTT = 0;
    let count = 0;

    input.hops.forEach((hop) => {
        hop.timings.forEach((timing) => {
            totalRTT += timing.rtt;
            count++;
        });
    });

    return count > 0 ? totalRTT / count : 0;
}

export function convertMsToDaysHours(ms: number): string {
    if (ms < 0 || !Number.isInteger(ms)) {
        throw new Error('Input must be a non-negative integer');
    }

    const msPerHour = 1000 * 60 * 60;
    const msPerDay = msPerHour * 24;

    const days = Math.floor(ms / msPerDay);
    const remainingMs = ms % msPerDay;
    const hours = Math.floor(remainingMs / msPerHour);

    return `${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`;
}

export function replaceSpecialChars(input: string): string {
    // Convert to lowercase
    let seoString = input.toLowerCase();

    // Remove special characters
    seoString = seoString.replace(/[^\w\s-]/g, '');

    // Replace spaces with hyphens
    seoString = seoString.replace(/\s+/g, '-');

    return seoString;
}

export async function sleep(seconds: number) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
