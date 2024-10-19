import { Telegraf } from 'telegraf';
import config from './config';

export async function sendMessage(bot: Telegraf, message: string, level: number = 0) {
    let telegramIds = process.env.NOTIFICATION_LIST ? process.env.NOTIFICATION_LIST.split(',') : [];

    if (telegramIds.length === 0) {
        throw new Error(
            `set NOTIFICATION_LIST env variable, current value is ${process.env.NOTIFICATION_LIST}`,
        );
    }
    let notificationLevel = parseInt(config.NOTIFICATION_LEVEL ?? '1');

    if (level >= notificationLevel) {
        for (let id of telegramIds) {
            await bot.telegram.sendMessage(id, message);
        }
    }
}
