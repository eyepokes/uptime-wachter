import { Globalping, MeasurementGetResponseBody } from 'globalping-ts';
import fs from 'fs';
import { convertMsToDaysHours, loadJSON, log, removeProperty } from './utils';
import { Measurement } from './types';
import { sleep } from './utils';
import { Telegraf } from 'telegraf';
import { sendMessage } from './telegram';
import {
    FinishedHttpTestResult,
    FinishedMtrTestResult,
    FinishedPingTestResult,
    FinishedSimpleDnsTestResult,
    FinishedTraceDnsTestResult,
    FinishedTracerouteTestResult,
} from 'globalping-ts/dist/types';
import config from "./config";

const RTT_THRESHOLDS = {
    NORMAL: 100,
    WARNING: 300,
};

const TTL_THRESHOLDS = {
    LOW: 32,
    HIGH: 255,
};

const JITTER_THRESHOLDS = {
    NORMAL: 30,
    WARNING: 100,
};

const HTTP_THRESHOLDS = {
    TOTAL: {
        NORMAL: 1000,
        WARNING: 3000,
    },
    DNS: {
        NORMAL: 100,
        WARNING: 300,
    },
    TCP: {
        NORMAL: 100,
        WARNING: 300,
    },
    TLS: {
        NORMAL: 200,
        WARNING: 500,
    },
    FIRST_BYTE: {
        NORMAL: 200,
        WARNING: 500,
    },
    DOWNLOAD: {
        NORMAL: 500,
        WARNING: 1500,
    },
};

export class Wachter {
    private static measurementsDirPath = './measurements';

    static async loadMeasurements(): Promise<Measurement[]> {
        log(`Wachter :: loadMeasurements() started`, 1);
        let measurementJsonFiles = fs
            .readdirSync(this.measurementsDirPath)
            .filter((file: any) => file.endsWith('.json'));

        if (measurementJsonFiles.length === 0) {
            log(`Wachter :: loadMeasurements(), loaded 0 measurements`, 2);
            return [];
        }
        let measurements = [];

        for (let filePath of measurementJsonFiles) {
            measurements.push(await loadJSON(`${this.measurementsDirPath}/${filePath}`));
        }

        return measurements;
    }

    static async runMeasurement(measurement: Measurement): Promise<MeasurementGetResponseBody | undefined> {
        log(`Wachter :: runMeasurement(${measurement.target}) :: started`, 1);
        try {
            const api = new Globalping({
                token: config.GLOBALPING_TOKEN,
                debug: false,
                disableEtagCaching: false,
                maxCacheSize: 200
            });

            log(`Wachter :: runMeasurement(${measurement.target}) :: posting measurement`, 1);
            let response = await api.postMeasurement(removeProperty(measurement, 'cronExpression'));

            if (!response.success) {
                throw new Error(JSON.stringify(response.error));
            }

            const { id } = response.data;

            let attempts = 120;
            for (let i = attempts; i >= 1; i--) {
                log(
                    `Wachter :: runMeasurement(${measurement.target}, ${id}) :: current attempt: ${i} out of ${attempts}`,
                    1,
                );

                let response = await api.getMeasurement(id);

                if (!response.success) {
                    throw new Error(JSON.stringify(response.error));
                }

                if (response.data.status === 'in-progress') {
                    await sleep(0.5);
                    continue;
                }

                return response.data;
            }
        } catch (e: any) {
            log(`Wachter :: runMeasurement(${measurement.target}) :: error occurred: ${e.message}`, 3);
        }
    }

    static async notify(bot: Telegraf, measurement: MeasurementGetResponseBody) {
        const messagePrefix = `Wachter :: notify(${measurement.target}) ::`;
        log(`${messagePrefix} started`, 1);
        try {
            for (let result of measurement.results) {
                if (['in-progress', 'failed', 'offline'].includes(result.result.status)) {
                    let message = `${messagePrefix} result status - ${result.result.status}`;
                    log(message, 3);
                    await sendMessage(bot, message, 3);
                } else {
                    let messages = [];

                    switch (measurement.type) {
                        case 'ping':
                            const pingTestResult = result.result as FinishedPingTestResult;

                            if (pingTestResult.stats.drop > 0) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: has dropped packets ${pingTestResult.stats.drop}(${pingTestResult.stats.loss}%)`,
                                    level: 3,
                                });
                            }

                            if (pingTestResult.stats.avg === null) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: average rtt is null`,
                                    level: 3,
                                });
                            } else if (pingTestResult.stats.avg <= RTT_THRESHOLDS.NORMAL) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: average rtt is ok ${pingTestResult.stats.avg} ms`,
                                    level: 1,
                                });
                            } else if (
                                pingTestResult.stats.avg > RTT_THRESHOLDS.NORMAL &&
                                pingTestResult.stats.avg <= RTT_THRESHOLDS.WARNING
                            ) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: average rtt is high ${pingTestResult.stats.avg} ms`,
                                    level: 2,
                                });
                            } else if (pingTestResult.stats.avg > RTT_THRESHOLDS.WARNING) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: average rtt is very high ${pingTestResult.stats.avg} ms`,
                                    level: 3,
                                });
                            }
                            break;
                        case 'traceroute':
                            const tracerouteTestResult = result.result as FinishedTracerouteTestResult;
                            let totalRTT = 0;
                            let count = 0;

                            tracerouteTestResult.hops.forEach((hop) => {
                                hop.timings.forEach((timing) => {
                                    totalRTT += timing.rtt;
                                    count++;
                                });
                            });

                            let averageRTT = count > 0 ? totalRTT / count : 0;

                            if (averageRTT <= RTT_THRESHOLDS.NORMAL) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: average rtt is ok ${averageRTT} ms`,
                                    level: 1,
                                });
                            }

                            if (averageRTT > RTT_THRESHOLDS.NORMAL && averageRTT <= RTT_THRESHOLDS.WARNING) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: average rtt is high ${averageRTT} ms`,
                                    level: 2,
                                });
                            }

                            if (averageRTT > RTT_THRESHOLDS.WARNING) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: average rtt is very high ${averageRTT} ms`,
                                    level: 3,
                                });
                            }
                            break;
                        case 'dns':
                            if (result.result.hasOwnProperty('answers')) {
                                const dnsTestResult = result.result as FinishedSimpleDnsTestResult;
                                let totalTTL = 0;
                                let count = 0;

                                dnsTestResult.answers.forEach((answer) => {
                                    totalTTL += answer.ttl;
                                    count++;
                                });

                                let averageTTL = count > 0 ? totalTTL / count : 0;

                                if (averageTTL <= TTL_THRESHOLDS.HIGH && averageTTL >= TTL_THRESHOLDS.LOW) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type}/simple dns test :: average ttl is ok ${averageTTL} ms`,
                                        level: 1,
                                    });
                                }

                                if (averageTTL > TTL_THRESHOLDS.HIGH) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type}/simple dns test :: average ttl is too high ${averageTTL} ms`,
                                        level: 2,
                                    });
                                }

                                if (averageTTL < TTL_THRESHOLDS.LOW) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type}/simple dns test :: average ttl is too low ${averageTTL} ms`,
                                        level: 3,
                                    });
                                }
                            } else {
                                const dnsTestResult = result.result as FinishedTraceDnsTestResult;
                                let totalTTL = 0;
                                let count = 0;

                                dnsTestResult.hops.forEach((hop) => {
                                    hop.answers.forEach((answer) => {
                                        totalTTL += answer.ttl;
                                        count++;
                                    });
                                });

                                let averageTTL = count > 0 ? totalTTL / count : 0;

                                if (averageTTL <= TTL_THRESHOLDS.HIGH && averageTTL >= TTL_THRESHOLDS.LOW) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type}/trace dns test :: average ttl is ok ${averageTTL} ms`,
                                        level: 1,
                                    });
                                }

                                if (averageTTL > TTL_THRESHOLDS.HIGH) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type}/trace dns test :: average ttl is too high ${averageTTL} ms`,
                                        level: 2,
                                    });
                                }

                                if (averageTTL < TTL_THRESHOLDS.LOW) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type}/trace dns test :: average ttl is too low ${averageTTL} ms`,
                                        level: 3,
                                    });
                                }
                            }
                            break;
                        case 'mtr':
                            const mtrTestResult = result.result as FinishedMtrTestResult;

                            mtrTestResult.hops.forEach((hop) => {
                                if (hop.stats.drop > 0) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type} :: has dropped packets ${hop.stats.drop}(${hop.stats.loss}%)`,
                                        level: 3,
                                    });
                                }

                                if (hop.stats.avg <= RTT_THRESHOLDS.NORMAL) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type} :: the average rtt is ok ${hop.stats.avg} ms`,
                                        level: 1,
                                    });
                                }

                                if (
                                    hop.stats.avg > RTT_THRESHOLDS.NORMAL &&
                                    hop.stats.avg <= RTT_THRESHOLDS.WARNING
                                ) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type} :: the average rtt is high ${hop.stats.avg} ms`,
                                        level: 2,
                                    });
                                }

                                if (hop.stats.avg > RTT_THRESHOLDS.WARNING) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type} :: the average rtt is very high ${hop.stats.avg} ms`,
                                        level: 3,
                                    });
                                }

                                if (hop.stats.jAvg <= JITTER_THRESHOLDS.NORMAL) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type} :: the average jitter is ok ${hop.stats.jAvg} ms`,
                                        level: 1,
                                    });
                                }

                                if (
                                    hop.stats.jAvg > JITTER_THRESHOLDS.NORMAL &&
                                    hop.stats.jAvg <= JITTER_THRESHOLDS.WARNING
                                ) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type} :: the average jitter is high ${hop.stats.jAvg} ms`,
                                        level: 2,
                                    });
                                }

                                if (hop.stats.jAvg > JITTER_THRESHOLDS.WARNING) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type} :: the average jitter is very high ${hop.stats.jAvg} ms`,
                                        level: 3,
                                    });
                                }
                            });

                            break;
                        case 'http':
                            const httpTestResult = result.result as FinishedHttpTestResult;

                            if (httpTestResult.timings.total === null) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the total HTTP request time is null`,
                                    level: 3,
                                });
                            } else if (httpTestResult.timings.total <= HTTP_THRESHOLDS.TOTAL.NORMAL) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the total HTTP request time is ok ${httpTestResult.timings.total} ms`,
                                    level: 1,
                                });
                            } else if (
                                httpTestResult.timings.total > HTTP_THRESHOLDS.TOTAL.NORMAL &&
                                httpTestResult.timings.total <= HTTP_THRESHOLDS.TOTAL.WARNING
                            ) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the total HTTP request time is high ${httpTestResult.timings.total} ms`,
                                    level: 2,
                                });
                            } else if (httpTestResult.timings.total > HTTP_THRESHOLDS.TOTAL.WARNING) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the total HTTP request time is very high ${httpTestResult.timings.total} ms`,
                                    level: 3,
                                });
                            }

                            if (httpTestResult.timings.dns === null) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time required to perform the DNS lookup is null`,
                                    level: 3,
                                });
                            } else if (httpTestResult.timings.dns <= HTTP_THRESHOLDS.DNS.NORMAL) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time required to perform the DNS lookup is ok ${httpTestResult.timings.dns} ms`,
                                    level: 1,
                                });
                            } else if (
                                httpTestResult.timings.dns > HTTP_THRESHOLDS.DNS.NORMAL &&
                                httpTestResult.timings.dns <= HTTP_THRESHOLDS.DNS.WARNING
                            ) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time required to perform the DNS lookup is high ${httpTestResult.timings.dns} ms`,
                                    level: 2,
                                });
                            } else if (httpTestResult.timings.dns > HTTP_THRESHOLDS.DNS.WARNING) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time required to perform the DNS lookup is very high ${httpTestResult.timings.dns} ms`,
                                    level: 3,
                                });
                            }

                            if (httpTestResult.timings.tcp === null) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from performing the DNS lookup to establishing the TCP connection is null`,
                                    level: 3,
                                });
                            } else if (httpTestResult.timings.tcp <= HTTP_THRESHOLDS.TCP.NORMAL) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from performing the DNS lookup to establishing the TCP connection is ok ${httpTestResult.timings.tcp} ms`,
                                    level: 1,
                                });
                            } else if (
                                httpTestResult.timings.tcp > HTTP_THRESHOLDS.TCP.NORMAL &&
                                httpTestResult.timings.tcp <= HTTP_THRESHOLDS.TCP.WARNING
                            ) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from performing the DNS lookup to establishing the TCP connection is high ${httpTestResult.timings.tcp} ms`,
                                    level: 2,
                                });
                            } else if (httpTestResult.timings.tcp > HTTP_THRESHOLDS.TCP.WARNING) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from performing the DNS lookup to establishing the TCP connection is very high ${httpTestResult.timings.tcp} ms`,
                                    level: 3,
                                });
                            }

                            if (httpTestResult.timings.tls === null) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from establishing the TCP connection to establishing the TLS session is null`,
                                    level: 3,
                                });
                            } else if (httpTestResult.timings.tls <= HTTP_THRESHOLDS.TLS.NORMAL) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from establishing the TCP connection to establishing the TLS session is ok ${httpTestResult.timings.tls} ms`,
                                    level: 1,
                                });
                            } else if (
                                httpTestResult.timings.tls > HTTP_THRESHOLDS.TLS.NORMAL &&
                                httpTestResult.timings.tls <= HTTP_THRESHOLDS.TLS.WARNING
                            ) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from establishing the TCP connection to establishing the TLS session is high ${httpTestResult.timings.tls} ms`,
                                    level: 2,
                                });
                            } else if (httpTestResult.timings.tls > HTTP_THRESHOLDS.TLS.WARNING) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from establishing the TCP connection to establishing the TLS session is very high ${httpTestResult.timings.tls} ms`,
                                    level: 3,
                                });
                            }

                            if (httpTestResult.timings.firstByte === null) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from establishing the TCP/TLS connection to the first response byte is null`,
                                    level: 3,
                                });
                            } else if (
                                httpTestResult.timings.firstByte <= HTTP_THRESHOLDS.FIRST_BYTE.NORMAL
                            ) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from establishing the TCP/TLS connection to the first response byte is ok ${httpTestResult.timings.firstByte} ms`,
                                    level: 1,
                                });
                            } else if (
                                httpTestResult.timings.firstByte > HTTP_THRESHOLDS.FIRST_BYTE.NORMAL &&
                                httpTestResult.timings.firstByte <= HTTP_THRESHOLDS.FIRST_BYTE.WARNING
                            ) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from establishing the TCP/TLS connection to the first response byte is high ${httpTestResult.timings.firstByte} ms`,
                                    level: 2,
                                });
                            } else if (
                                httpTestResult.timings.firstByte > HTTP_THRESHOLDS.FIRST_BYTE.WARNING
                            ) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from establishing the TCP/TLS connection to the first response byte is very high ${httpTestResult.timings.firstByte} ms`,
                                    level: 3,
                                });
                            }

                            if (httpTestResult.timings.download === null) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from the first response byte to downloading the entire response is null`,
                                    level: 3,
                                });
                            } else if (httpTestResult.timings.download <= HTTP_THRESHOLDS.FIRST_BYTE.NORMAL) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from the first response byte to downloading the entire response is ok ${httpTestResult.timings.download} ms`,
                                    level: 1,
                                });
                            } else if (
                                httpTestResult.timings.download > HTTP_THRESHOLDS.FIRST_BYTE.NORMAL &&
                                httpTestResult.timings.download <= HTTP_THRESHOLDS.FIRST_BYTE.WARNING
                            ) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from the first response byte to downloading the entire response is high ${httpTestResult.timings.download} ms`,
                                    level: 2,
                                });
                            } else if (httpTestResult.timings.download > HTTP_THRESHOLDS.FIRST_BYTE.WARNING) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: the time from the first response byte to downloading the entire response is very high ${httpTestResult.timings.download} ms`,
                                    level: 3,
                                });
                            }

                            if (httpTestResult.tls === null) {
                                messages.push({
                                    message: `${messagePrefix} ${measurement.type} :: no TLS certificate is available`,
                                    level: 1,
                                });
                            }

                            if (httpTestResult.tls) {
                                if (!httpTestResult.tls.authorized) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type} :: the certificate is not authorized(${httpTestResult.tls.error})`,
                                        level: 3,
                                    });
                                }

                                let now = Date.now();
                                let expireTime = new Date(httpTestResult.tls.expiresAt).getTime();
                                let diff = expireTime - now;

                                if (diff < 0) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type} :: the certificate is expired(expiration date - ${httpTestResult.tls.expiresAt})`,
                                        level: 3,
                                    });
                                } else if (diff <= 2592e6 && diff > 6048e5) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type} :: the certificate will expire in ${convertMsToDaysHours(diff)}`,
                                        level: 2,
                                    });
                                } else if (diff <= 6048e5) {
                                    messages.push({
                                        message: `${messagePrefix} ${measurement.type} :: the certificate will expire in ${convertMsToDaysHours(diff)}`,
                                        level: 3,
                                    });
                                }
                            }

                            break;
                    }

                    for (let message of messages) {
                        log(message.message, message.level);
                        await sendMessage(bot, message.message, message.level);
                    }
                }
            }
        } catch (e: any) {
            let message = `Wachter :: notify() :: error occurred: ${e.message}`;
            log(message, 3);
            await sendMessage(bot, message, 3);
        }
    }
}
