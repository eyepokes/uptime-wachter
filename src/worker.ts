import { Telegraf } from 'telegraf';
import { Wachter } from './wachter';
import { replaceSpecialChars } from './utils';
import { DateTime } from 'luxon';
import { CronJob } from 'cron';
import { writeFile } from 'fs/promises';
import path from 'path';
import config from './config';

process.on('message', async (message: any) => {
    try {
        let telegramToken = process.env.TELEGRAM_TOKEN ?? '';
        if (telegramToken === '') {
            throw new Error(`set TELEGRAM_TOKEN variable, current value is ${process.env.TELEGRAM_TOKEN}`);
        }

        const bot = new Telegraf(telegramToken);
        let measurements = await Wachter.loadMeasurements();
        const timezone = config.TIMEZONE || 'UTC';
        for (let j = 0; j < measurements.length; j++) {
            const job = new CronJob(
                measurements[j].cronExpression, // cronTime
                async function () {
                    let measurement = await Wachter.runMeasurement(measurements[j]);
                    if (measurement) {
                        const timestamp = DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd_HH-mm-ss');
                        await writeFile(
                            path.resolve(
                                config.MEASUREMENTS_PATH,
                                replaceSpecialChars(
                                    `${timestamp}_${measurement.target}-${measurement.type}`,
                                ) + '.json',
                            ),
                            JSON.stringify(measurement, null, 4),
                        );
                        await Wachter.notify(bot, measurement);
                    }
                },
                null,
                true,
                process.env.TIMEZONE,
                null,
                true,
            );
        }
    } catch (e: any) {
        if (process.send) {
            process.send(e.message);
        }
        process.exit(1);
    }
});
