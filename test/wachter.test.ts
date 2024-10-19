import assert from 'assert';
import sinon from 'sinon';
import { Wachter } from '../src/wachter';
import { Globalping, MeasurementGetResponseBody } from 'globalping-ts';
import { Telegraf } from 'telegraf';
import * as utils from '../src/utils';
import * as telegram from '../src/telegram';
import { Measurement } from '../dist/types';
import { FinishedSimpleDnsTestResult, FinishedTraceDnsTestResult } from 'globalping-ts/src/types';

describe('Wachter', () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('loadMeasurements', () => {
        it('should load measurements from JSON files', async () => {
            const fakeFiles = ['measurement1.json', 'measurement2.json'];
            let readdirSyncStub = sandbox.stub(require('fs'), 'readdirSync').returns(fakeFiles);
            const loadJSONStub = sandbox.stub(utils, 'loadJSON').resolves({ target: 'example.com' });

            const measurements = await Wachter.loadMeasurements();

            assert.strictEqual(measurements.length, 2);

            for (let i = 0; i < 2; i++) {
                assert.deepStrictEqual(measurements[i], { target: 'example.com' });
            }

            sinon.assert.calledOnce(readdirSyncStub);
            sinon.assert.calledTwice(loadJSONStub);
        });

        it('should return an empty array when no JSON files are found', async () => {
            sandbox.stub(require('fs'), 'readdirSync').returns([]);

            const measurements = await Wachter.loadMeasurements();

            assert.strictEqual(measurements.length, 0);
        });
    });

    describe('runMeasurement', () => {
        it('should successfully run a measurement', async () => {
            const measurement: Measurement = {
                target: 'example.com',
                type: 'ping',
                cronExpression: '* * * * *',
            };
            const postMeasurementStub = sandbox.stub().resolves({ success: true, data: { id: '123' } });
            const getMeasurementStub = sandbox
                .stub()
                .resolves({ success: true, data: { status: 'finished', results: [] } });

            sandbox.stub(Globalping.prototype, 'postMeasurement').get(() => postMeasurementStub);
            sandbox.stub(Globalping.prototype, 'getMeasurement').get(() => getMeasurementStub);

            const result = await Wachter.runMeasurement(measurement);

            assert.deepStrictEqual(result, { status: 'finished', results: [] });
            sinon.assert.calledOnce(postMeasurementStub);
            sinon.assert.calledOnce(getMeasurementStub);
        });

        it('should handle measurement errors', async () => {
            const measurement: Measurement = {
                target: 'example.com',
                type: 'ping',
                cronExpression: '* * * * *',
            };
            sandbox.stub(Globalping.prototype, 'postMeasurement').rejects(new Error('API Error'));

            const result = await Wachter.runMeasurement(measurement);

            assert.strictEqual(result, undefined);
        });
    });

    describe('notify', () => {
        it('should send notifications for ping measurements', async () => {
            const bot = {} as Telegraf;
            let measurement: MeasurementGetResponseBody = {
                id: '123',
                target: 'example.com',
                type: 'ping',
                status: 'finished',
                createdAt: '2024-10-10',
                updatedAt: '2024-10-10',
                probesCount: 1,
                results: [
                    {
                        probe: {
                            continent: 'SA',
                            region: 'South America',
                            country: 'US',
                            state: null,
                            city: 'Example city',
                            asn: 123,
                            network: 'string',
                            latitude: 4234.2,
                            longitude: 4234.2,
                            resolvers: ['', ''],
                        },
                        result: {
                            status: 'finished',
                            rawOutput: '',
                            resolvedAddress: null,
                            resolvedHostname: null,
                            stats: {
                                min: 40,
                                avg: 50,
                                max: 60,
                                total: 2,
                                rcv: 2,
                                drop: 0,
                                loss: 0,
                            },
                            timings: [
                                {
                                    rtt: 40,
                                    ttl: 30,
                                },
                                {
                                    rtt: 60,
                                    ttl: 30,
                                },
                            ],
                        },
                    },
                ],
            };

            const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
            const logStub = sandbox.stub(utils, 'log');

            await Wachter.notify(bot, measurement);
            let message = 'Wachter :: notify(example.com) :: ping :: average rtt is ok 50 ms';
            sinon.assert.calledWith(sendMessageStub, bot, message, 1);
            sinon.assert.calledWith(logStub, message, 1);

            sinon.assert.callCount(sendMessageStub, 1);
            sinon.assert.callCount(logStub, 2);
        });

        it('should handle failed measurement results', async () => {
            const bot = {} as Telegraf;
            let measurement: MeasurementGetResponseBody = {
                id: '123',
                target: 'example.com',
                type: 'ping',
                status: 'finished',
                createdAt: '2024-10-10',
                updatedAt: '2024-10-10',
                probesCount: 1,
                results: [
                    {
                        probe: {
                            continent: 'SA',
                            region: 'South America',
                            country: 'US',
                            state: null,
                            city: 'Example city',
                            asn: 123,
                            network: 'string',
                            latitude: 4234.2,
                            longitude: 4234.2,
                            resolvers: ['', ''],
                        },
                        result: {
                            status: 'failed',
                            rawOutput: 'some error occurred',
                        },
                    },
                ],
            };

            const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
            const logStub = sandbox.stub(utils, 'log');

            await Wachter.notify(bot, measurement);

            let message = 'Wachter :: notify(example.com) :: result status - failed';
            sinon.assert.calledWith(sendMessageStub, bot, message, 3);
            sinon.assert.calledWith(logStub, message, 3);

            sinon.assert.callCount(sendMessageStub, 1);
            sinon.assert.callCount(logStub, 2);
        });

        describe('notify ping measurements', () => {
            it('should send notifications for ping measurements about dropped packets', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'ping',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                resolvedAddress: null,
                                resolvedHostname: null,
                                stats: {
                                    min: 40,
                                    avg: 50,
                                    max: 60,
                                    total: 2,
                                    rcv: 2,
                                    drop: 1,
                                    loss: 50,
                                },
                                timings: [
                                    {
                                        rtt: 40,
                                        ttl: 30,
                                    },
                                    {
                                        rtt: 60,
                                        ttl: 30,
                                    },
                                ],
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);

                let message = 'Wachter :: notify(example.com) :: ping :: has dropped packets 1(50%)';
                sinon.assert.calledWith(sendMessageStub, bot, message, 3);
                sinon.assert.calledWith(logStub, message, 3);

                sinon.assert.callCount(sendMessageStub, 2);
                sinon.assert.callCount(logStub, 3);
            });

            it('should send notifications for ping measurements: average rtt is null', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'ping',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                resolvedAddress: null,
                                resolvedHostname: null,
                                stats: {
                                    min: 40,
                                    avg: null,
                                    max: 60,
                                    total: 2,
                                    rcv: 2,
                                    drop: 0,
                                    loss: 0,
                                },
                                timings: [
                                    {
                                        rtt: 40,
                                        ttl: 30,
                                    },
                                    {
                                        rtt: 60,
                                        ttl: 30,
                                    },
                                ],
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);

                let message = 'Wachter :: notify(example.com) :: ping :: average rtt is null';
                sinon.assert.calledWith(sendMessageStub, bot, message, 3);
                sinon.assert.calledWith(logStub, message, 3);

                sinon.assert.callCount(sendMessageStub, 1);
                sinon.assert.callCount(logStub, 2);
            });

            it('should send notifications for ping measurements: average rtt is ok', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'ping',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                resolvedAddress: null,
                                resolvedHostname: null,
                                stats: {
                                    min: 40,
                                    avg: 50,
                                    max: 60,
                                    total: 2,
                                    rcv: 2,
                                    drop: 0,
                                    loss: 0,
                                },
                                timings: [
                                    {
                                        rtt: 40,
                                        ttl: 30,
                                    },
                                    {
                                        rtt: 60,
                                        ttl: 30,
                                    },
                                ],
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);

                let message = 'Wachter :: notify(example.com) :: ping :: average rtt is ok 50 ms';
                sinon.assert.calledWith(sendMessageStub, bot, message, 1);
                sinon.assert.calledWith(logStub, message, 1);

                sinon.assert.callCount(sendMessageStub, 1);
                sinon.assert.callCount(logStub, 2);
            });

            it('should send notifications for ping measurements: average rtt is high', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'ping',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                resolvedAddress: null,
                                resolvedHostname: null,
                                stats: {
                                    min: 40,
                                    avg: 150,
                                    max: 60,
                                    total: 2,
                                    rcv: 2,
                                    drop: 0,
                                    loss: 0,
                                },
                                timings: [
                                    {
                                        rtt: 40,
                                        ttl: 30,
                                    },
                                    {
                                        rtt: 60,
                                        ttl: 30,
                                    },
                                ],
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);

                let message = 'Wachter :: notify(example.com) :: ping :: average rtt is high 150 ms';
                sinon.assert.calledWith(sendMessageStub, bot, message, 2);
                sinon.assert.calledWith(logStub, message, 2);

                sinon.assert.callCount(sendMessageStub, 1);
                sinon.assert.callCount(logStub, 2);
            });

            it('should send notifications for ping measurements: average rtt is very high', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'ping',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                resolvedAddress: null,
                                resolvedHostname: null,
                                stats: {
                                    min: 40,
                                    avg: 350,
                                    max: 60,
                                    total: 2,
                                    rcv: 2,
                                    drop: 0,
                                    loss: 0,
                                },
                                timings: [
                                    {
                                        rtt: 40,
                                        ttl: 30,
                                    },
                                    {
                                        rtt: 60,
                                        ttl: 30,
                                    },
                                ],
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);

                let message = 'Wachter :: notify(example.com) :: ping :: average rtt is very high 350 ms';
                sinon.assert.calledWith(sendMessageStub, bot, message, 3);
                sinon.assert.calledWith(logStub, message, 3);

                sinon.assert.callCount(sendMessageStub, 1);
                sinon.assert.callCount(logStub, 2);
            });
        });

        describe('notify traceroute measurements', () => {
            it('should send notifications for traceroute measurements: average rtt is ok', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'traceroute',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                resolvedAddress: null,
                                resolvedHostname: null,
                                hops: [
                                    {
                                        resolvedAddress: '',
                                        resolvedHostname: '',
                                        timings: [
                                            {
                                                rtt: 50,
                                            },
                                            {
                                                rtt: 20,
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);
                let message = 'Wachter :: notify(example.com) :: traceroute :: average rtt is ok 35 ms';
                sinon.assert.calledWith(sendMessageStub, bot, message, 1);
                sinon.assert.calledWith(logStub, message, 1);

                sinon.assert.callCount(sendMessageStub, 1);
                sinon.assert.callCount(logStub, 2);
            });

            it('should send notifications for traceroute measurements: average rtt is high', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'traceroute',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                resolvedAddress: null,
                                resolvedHostname: null,
                                hops: [
                                    {
                                        resolvedAddress: '',
                                        resolvedHostname: '',
                                        timings: [
                                            {
                                                rtt: 250,
                                            },
                                            {
                                                rtt: 150,
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);
                let message = 'Wachter :: notify(example.com) :: traceroute :: average rtt is high 200 ms';
                sinon.assert.calledWith(sendMessageStub, bot, message, 2);
                sinon.assert.calledWith(logStub, message, 2);

                sinon.assert.callCount(sendMessageStub, 1);
                sinon.assert.callCount(logStub, 2);
            });

            it('should send notifications for traceroute measurements: average rtt is very high', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'traceroute',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                resolvedAddress: null,
                                resolvedHostname: null,
                                hops: [
                                    {
                                        resolvedAddress: '',
                                        resolvedHostname: '',
                                        timings: [
                                            {
                                                rtt: 350,
                                            },
                                            {
                                                rtt: 260,
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);
                let message =
                    'Wachter :: notify(example.com) :: traceroute :: average rtt is very high 305 ms';
                sinon.assert.calledWith(sendMessageStub, bot, message, 3);
                sinon.assert.calledWith(logStub, message, 3);

                sinon.assert.callCount(sendMessageStub, 1);
                sinon.assert.callCount(logStub, 2);
            });
        });

        describe('notify dns measurements', () => {
            describe('simple dns test', () => {
                it('should send notifications for dns measurements(simple dns test): average ttl is ok', async () => {
                    const bot = {} as Telegraf;
                    let measurement: MeasurementGetResponseBody = {
                        id: '123',
                        target: 'example.com',
                        type: 'dns',
                        status: 'finished',
                        createdAt: '2024-10-10',
                        updatedAt: '2024-10-10',
                        probesCount: 1,
                        results: [
                            {
                                probe: {
                                    continent: 'SA',
                                    region: 'South America',
                                    country: 'US',
                                    state: null,
                                    city: 'Example city',
                                    asn: 123,
                                    network: 'string',
                                    latitude: 4234.2,
                                    longitude: 4234.2,
                                    resolvers: ['', ''],
                                },
                                result: {
                                    status: 'finished',
                                    rawOutput: '',
                                    statusCode: 200,
                                    statusCodeName: 'OK',
                                    resolver: '',
                                    answers: [
                                        {
                                            name: 'some name',
                                            type: 'some type',
                                            ttl: 50,
                                            class: 'some class',
                                            value: '',
                                        },
                                        {
                                            name: 'some name',
                                            type: 'some type',
                                            ttl: 25,
                                            class: 'some class',
                                            value: '',
                                        },
                                    ],
                                    timings: {
                                        total: 150,
                                    },
                                } as FinishedSimpleDnsTestResult,
                            },
                        ],
                    };

                    const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                    const logStub = sandbox.stub(utils, 'log');

                    await Wachter.notify(bot, measurement);
                    let message =
                        'Wachter :: notify(example.com) :: dns/simple dns test :: average ttl is ok 37.5 ms';
                    sinon.assert.calledWith(sendMessageStub, bot, message, 1);
                    sinon.assert.calledWith(logStub, message, 1);

                    sinon.assert.callCount(sendMessageStub, 1);
                    sinon.assert.callCount(logStub, 2);
                });

                it('should send notifications for dns measurements(simple dns test): average ttl average ttl is too high', async () => {
                    const bot = {} as Telegraf;
                    let measurement: MeasurementGetResponseBody = {
                        id: '123',
                        target: 'example.com',
                        type: 'dns',
                        status: 'finished',
                        createdAt: '2024-10-10',
                        updatedAt: '2024-10-10',
                        probesCount: 1,
                        results: [
                            {
                                probe: {
                                    continent: 'SA',
                                    region: 'South America',
                                    country: 'US',
                                    state: null,
                                    city: 'Example city',
                                    asn: 123,
                                    network: 'string',
                                    latitude: 4234.2,
                                    longitude: 4234.2,
                                    resolvers: ['', ''],
                                },
                                result: {
                                    status: 'finished',
                                    rawOutput: '',
                                    statusCode: 200,
                                    statusCodeName: 'OK',
                                    resolver: '',
                                    answers: [
                                        {
                                            name: 'some name',
                                            type: 'some type',
                                            ttl: 259,
                                            class: 'some class',
                                            value: '',
                                        },
                                        {
                                            name: 'some name',
                                            type: 'some type',
                                            ttl: 354,
                                            class: 'some class',
                                            value: '',
                                        },
                                    ],
                                    timings: {
                                        total: 150,
                                    },
                                } as FinishedSimpleDnsTestResult,
                            },
                        ],
                    };

                    const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                    const logStub = sandbox.stub(utils, 'log');

                    await Wachter.notify(bot, measurement);
                    let message =
                        'Wachter :: notify(example.com) :: dns/simple dns test :: average ttl is too high 306.5 ms';
                    sinon.assert.calledWith(sendMessageStub, bot, message, 2);
                    sinon.assert.calledWith(logStub, message, 2);

                    sinon.assert.callCount(sendMessageStub, 1);
                    sinon.assert.callCount(logStub, 2);
                });

                it('should send notifications for dns measurements(simple dns test): average ttl average ttl is too low', async () => {
                    const bot = {} as Telegraf;
                    let measurement: MeasurementGetResponseBody = {
                        id: '123',
                        target: 'example.com',
                        type: 'dns',
                        status: 'finished',
                        createdAt: '2024-10-10',
                        updatedAt: '2024-10-10',
                        probesCount: 1,
                        results: [
                            {
                                probe: {
                                    continent: 'SA',
                                    region: 'South America',
                                    country: 'US',
                                    state: null,
                                    city: 'Example city',
                                    asn: 123,
                                    network: 'string',
                                    latitude: 4234.2,
                                    longitude: 4234.2,
                                    resolvers: ['', ''],
                                },
                                result: {
                                    status: 'finished',
                                    rawOutput: '',
                                    statusCode: 200,
                                    statusCodeName: 'OK',
                                    resolver: '',
                                    answers: [
                                        {
                                            name: 'some name',
                                            type: 'some type',
                                            ttl: 25,
                                            class: 'some class',
                                            value: '',
                                        },
                                        {
                                            name: 'some name',
                                            type: 'some type',
                                            ttl: 35,
                                            class: 'some class',
                                            value: '',
                                        },
                                    ],
                                    timings: {
                                        total: 150,
                                    },
                                } as FinishedSimpleDnsTestResult,
                            },
                        ],
                    };

                    const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                    const logStub = sandbox.stub(utils, 'log');

                    await Wachter.notify(bot, measurement);
                    let message =
                        'Wachter :: notify(example.com) :: dns/simple dns test :: average ttl is too low 30 ms';
                    sinon.assert.calledWith(sendMessageStub, bot, message, 3);
                    sinon.assert.calledWith(logStub, message, 3);

                    sinon.assert.callCount(sendMessageStub, 1);
                    sinon.assert.callCount(logStub, 2);
                });
            });

            describe('trace dns test', () => {
                it('should send notifications for dns measurements(trace dns test): average ttl average ttl is ok', async () => {
                    const bot = {} as Telegraf;
                    let measurement: MeasurementGetResponseBody = {
                        id: '123',
                        target: 'example.com',
                        type: 'dns',
                        status: 'finished',
                        createdAt: '2024-10-10',
                        updatedAt: '2024-10-10',
                        probesCount: 1,
                        results: [
                            {
                                probe: {
                                    continent: 'SA',
                                    region: 'South America',
                                    country: 'US',
                                    state: null,
                                    city: 'Example city',
                                    asn: 123,
                                    network: 'string',
                                    latitude: 4234.2,
                                    longitude: 4234.2,
                                    resolvers: ['', ''],
                                },
                                result: {
                                    hops: [
                                        {
                                            resolver: '',
                                            answers: [
                                                {
                                                    name: 'some name',
                                                    type: 'some type',
                                                    ttl: 35,
                                                    class: 'some class',
                                                    value: 'some value',
                                                },
                                                {
                                                    name: 'some name',
                                                    type: 'some type',
                                                    ttl: 45,
                                                    class: 'some class',
                                                    value: 'some value',
                                                },
                                            ],
                                            timings: {
                                                total: 123,
                                            },
                                        },
                                    ],
                                } as FinishedTraceDnsTestResult,
                            },
                        ],
                    };

                    const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                    const logStub = sandbox.stub(utils, 'log');

                    await Wachter.notify(bot, measurement);
                    let message =
                        'Wachter :: notify(example.com) :: dns/trace dns test :: average ttl is ok 40 ms';
                    sinon.assert.calledWith(sendMessageStub, bot, message, 1);
                    sinon.assert.calledWith(logStub, message, 1);
                });

                it('should send notifications for dns measurements(trace dns test): average ttl average ttl is too high', async () => {
                    const bot = {} as Telegraf;
                    let measurement: MeasurementGetResponseBody = {
                        id: '123',
                        target: 'example.com',
                        type: 'dns',
                        status: 'finished',
                        createdAt: '2024-10-10',
                        updatedAt: '2024-10-10',
                        probesCount: 1,
                        results: [
                            {
                                probe: {
                                    continent: 'SA',
                                    region: 'South America',
                                    country: 'US',
                                    state: null,
                                    city: 'Example city',
                                    asn: 123,
                                    network: 'string',
                                    latitude: 4234.2,
                                    longitude: 4234.2,
                                    resolvers: ['', ''],
                                },
                                result: {
                                    hops: [
                                        {
                                            resolver: '',
                                            answers: [
                                                {
                                                    name: 'some name',
                                                    type: 'some type',
                                                    ttl: 235,
                                                    class: 'some class',
                                                    value: 'some value',
                                                },
                                                {
                                                    name: 'some name',
                                                    type: 'some type',
                                                    ttl: 445,
                                                    class: 'some class',
                                                    value: 'some value',
                                                },
                                            ],
                                            timings: {
                                                total: 123,
                                            },
                                        },
                                    ],
                                } as FinishedTraceDnsTestResult,
                            },
                        ],
                    };

                    const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                    const logStub = sandbox.stub(utils, 'log');

                    await Wachter.notify(bot, measurement);
                    let message =
                        'Wachter :: notify(example.com) :: dns/trace dns test :: average ttl is too high 340 ms';
                    sinon.assert.calledWith(sendMessageStub, bot, message, 2);
                    sinon.assert.calledWith(logStub, message, 2);
                });

                it('should send notifications for dns measurements(trace dns test): average ttl average ttl is too low', async () => {
                    const bot = {} as Telegraf;
                    let measurement: MeasurementGetResponseBody = {
                        id: '123',
                        target: 'example.com',
                        type: 'dns',
                        status: 'finished',
                        createdAt: '2024-10-10',
                        updatedAt: '2024-10-10',
                        probesCount: 1,
                        results: [
                            {
                                probe: {
                                    continent: 'SA',
                                    region: 'South America',
                                    country: 'US',
                                    state: null,
                                    city: 'Example city',
                                    asn: 123,
                                    network: 'string',
                                    latitude: 4234.2,
                                    longitude: 4234.2,
                                    resolvers: ['', ''],
                                },
                                result: {
                                    hops: [
                                        {
                                            resolver: '',
                                            answers: [
                                                {
                                                    name: 'some name',
                                                    type: 'some type',
                                                    ttl: 23,
                                                    class: 'some class',
                                                    value: 'some value',
                                                },
                                                {
                                                    name: 'some name',
                                                    type: 'some type',
                                                    ttl: 12,
                                                    class: 'some class',
                                                    value: 'some value',
                                                },
                                            ],
                                            timings: {
                                                total: 123,
                                            },
                                        },
                                    ],
                                } as FinishedTraceDnsTestResult,
                            },
                        ],
                    };

                    const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                    const logStub = sandbox.stub(utils, 'log');

                    await Wachter.notify(bot, measurement);
                    let message =
                        'Wachter :: notify(example.com) :: dns/trace dns test :: average ttl is too low 17.5 ms';
                    sinon.assert.calledWith(sendMessageStub, bot, message, 3);
                    sinon.assert.calledWith(logStub, message, 3);
                });
            });
        });

        describe('notify mtr measurements', () => {
            it('should send 3 notifications for mtr measurements has dropped packets, rtt is ok, jitter is ok', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'mtr',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                resolvedAddress: '',
                                resolvedHostname: '',
                                hops: [
                                    {
                                        resolvedAddress: '',
                                        resolvedHostname: '',
                                        asn: [1, 2],
                                        stats: {
                                            min: 12,
                                            avg: 50,
                                            max: 65,
                                            stDev: 12,
                                            jMin: 124,
                                            jAvg: 23,
                                            jMax: 123,
                                            total: 12,
                                            rcv: 124,
                                            drop: 1,
                                            loss: 50,
                                        },
                                        timings: [
                                            {
                                                rtt: 12,
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);
                let messages = [
                    'Wachter :: notify(example.com) :: mtr :: has dropped packets 1(50%)',
                    'Wachter :: notify(example.com) :: mtr :: the average rtt is ok 50 ms',
                    'Wachter :: notify(example.com) :: mtr :: the average jitter is ok 23 ms',
                ];
                sinon.assert.calledWith(sendMessageStub.getCalls()[0], bot, messages[0], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[1], bot, messages[1], 1);
                sinon.assert.calledWith(sendMessageStub.getCalls()[2], bot, messages[2], 1);
                sinon.assert.calledWith(logStub.getCalls()[1], messages[0], 3);
                sinon.assert.calledWith(logStub.getCalls()[2], messages[1], 1);
                sinon.assert.calledWith(logStub.getCalls()[3], messages[2], 1);

                sinon.assert.callCount(sendMessageStub, 3);
                sinon.assert.callCount(logStub, 4);
            });

            it('should send 2 notifications for mtr measurements rtt is high, jitter is high', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'mtr',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                resolvedAddress: '',
                                resolvedHostname: '',
                                hops: [
                                    {
                                        resolvedAddress: '',
                                        resolvedHostname: '',
                                        asn: [1, 2],
                                        stats: {
                                            min: 12,
                                            avg: 256,
                                            max: 65,
                                            stDev: 12,
                                            jMin: 124,
                                            jAvg: 56,
                                            jMax: 123,
                                            total: 12,
                                            rcv: 124,
                                            drop: 0,
                                            loss: 0,
                                        },
                                        timings: [
                                            {
                                                rtt: 12,
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);
                let messages = [
                    'Wachter :: notify(example.com) :: mtr :: the average rtt is high 256 ms',
                    'Wachter :: notify(example.com) :: mtr :: the average jitter is high 56 ms',
                ];
                sinon.assert.calledWith(sendMessageStub.getCalls()[0], bot, messages[0], 2);
                sinon.assert.calledWith(sendMessageStub.getCalls()[1], bot, messages[1], 2);
                sinon.assert.calledWith(logStub.getCalls()[1], messages[0], 2);
                sinon.assert.calledWith(logStub.getCalls()[2], messages[1], 2);

                sinon.assert.callCount(sendMessageStub, 2);
                sinon.assert.callCount(logStub, 3);
            });

            it('should send 2 notifications for mtr measurements rtt is very high, jitter is very high', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'mtr',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                resolvedAddress: '',
                                resolvedHostname: '',
                                hops: [
                                    {
                                        resolvedAddress: '',
                                        resolvedHostname: '',
                                        asn: [1, 2],
                                        stats: {
                                            min: 12,
                                            avg: 302,
                                            max: 65,
                                            stDev: 12,
                                            jMin: 124,
                                            jAvg: 156,
                                            jMax: 123,
                                            total: 12,
                                            rcv: 124,
                                            drop: 0,
                                            loss: 0,
                                        },
                                        timings: [
                                            {
                                                rtt: 12,
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);
                let messages = [
                    'Wachter :: notify(example.com) :: mtr :: the average rtt is very high 302 ms',
                    'Wachter :: notify(example.com) :: mtr :: the average jitter is very high 156 ms',
                ];
                sinon.assert.calledWith(sendMessageStub.getCalls()[0], bot, messages[0], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[1], bot, messages[1], 3);
                sinon.assert.calledWith(logStub.getCalls()[1], messages[0], 3);
                sinon.assert.calledWith(logStub.getCalls()[2], messages[1], 3);

                sinon.assert.callCount(sendMessageStub, 2);
                sinon.assert.callCount(logStub, 3);
            });
        });

        describe('notify http measurements', () => {
            it('should send notifications for 7 http measurements: timings null, no tls', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'http',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                rawHeaders: '',
                                rawBody: '',
                                truncated: false,
                                headers: {
                                    'some-header': 'some header value',
                                },
                                statusCode: 200,
                                statusCodeName: 'OK',
                                resolvedAddress: '',
                                timings: {
                                    total: null,
                                    dns: null,
                                    tcp: null,
                                    tls: null,
                                    firstByte: null,
                                    download: null,
                                },
                                tls: null,
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);
                let messages = [
                    'Wachter :: notify(example.com) :: http :: the total HTTP request time is null',
                    'Wachter :: notify(example.com) :: http :: the time required to perform the DNS lookup is null',
                    'Wachter :: notify(example.com) :: http :: the time from performing the DNS lookup to establishing the TCP connection is null',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP connection to establishing the TLS session is null',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP/TLS connection to the first response byte is null',
                    'Wachter :: notify(example.com) :: http :: the time from the first response byte to downloading the entire response is null',
                    'Wachter :: notify(example.com) :: http :: no TLS certificate is available',
                ];
                sinon.assert.calledWith(sendMessageStub.getCalls()[0], bot, messages[0], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[1], bot, messages[1], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[2], bot, messages[2], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[3], bot, messages[3], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[4], bot, messages[4], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[5], bot, messages[5], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[6], bot, messages[6], 1);
                sinon.assert.calledWith(logStub.getCalls()[1], messages[0], 3);
                sinon.assert.calledWith(logStub.getCalls()[2], messages[1], 3);
                sinon.assert.calledWith(logStub.getCalls()[3], messages[2], 3);
                sinon.assert.calledWith(logStub.getCalls()[4], messages[3], 3);
                sinon.assert.calledWith(logStub.getCalls()[5], messages[4], 3);
                sinon.assert.calledWith(logStub.getCalls()[6], messages[5], 3);
                sinon.assert.calledWith(logStub.getCalls()[7], messages[6], 1);

                sinon.assert.callCount(sendMessageStub, 7);
                sinon.assert.callCount(logStub, 8);
            });

            it('should send notifications for 7 http measurements: everything is ok, no tls', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'http',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                rawHeaders: '',
                                rawBody: '',
                                truncated: false,
                                headers: {
                                    'some-header': 'some header value',
                                },
                                statusCode: 200,
                                statusCodeName: 'OK',
                                resolvedAddress: '',
                                timings: {
                                    total: 123,
                                    dns: 99,
                                    tcp: 98,
                                    tls: 97,
                                    firstByte: 12,
                                    download: 100,
                                },
                                tls: null,
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);
                let messages = [
                    'Wachter :: notify(example.com) :: http :: the total HTTP request time is ok 123 ms',
                    'Wachter :: notify(example.com) :: http :: the time required to perform the DNS lookup is ok 99 ms',
                    'Wachter :: notify(example.com) :: http :: the time from performing the DNS lookup to establishing the TCP connection is ok 98 ms',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP connection to establishing the TLS session is ok 97 ms',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP/TLS connection to the first response byte is ok 12 ms',
                    'Wachter :: notify(example.com) :: http :: the time from the first response byte to downloading the entire response is ok 100 ms',
                    'Wachter :: notify(example.com) :: http :: no TLS certificate is available',
                ];
                sinon.assert.calledWith(sendMessageStub.getCalls()[0], bot, messages[0], 1);
                sinon.assert.calledWith(sendMessageStub.getCalls()[1], bot, messages[1], 1);
                sinon.assert.calledWith(sendMessageStub.getCalls()[2], bot, messages[2], 1);
                sinon.assert.calledWith(sendMessageStub.getCalls()[3], bot, messages[3], 1);
                sinon.assert.calledWith(sendMessageStub.getCalls()[4], bot, messages[4], 1);
                sinon.assert.calledWith(sendMessageStub.getCalls()[5], bot, messages[5], 1);
                sinon.assert.calledWith(sendMessageStub.getCalls()[6], bot, messages[6], 1);
                sinon.assert.calledWith(logStub.getCalls()[1], messages[0], 1);
                sinon.assert.calledWith(logStub.getCalls()[2], messages[1], 1);
                sinon.assert.calledWith(logStub.getCalls()[3], messages[2], 1);
                sinon.assert.calledWith(logStub.getCalls()[4], messages[3], 1);
                sinon.assert.calledWith(logStub.getCalls()[5], messages[4], 1);
                sinon.assert.calledWith(logStub.getCalls()[6], messages[5], 1);
                sinon.assert.calledWith(logStub.getCalls()[7], messages[6], 1);

                sinon.assert.callCount(sendMessageStub, 7);
                sinon.assert.callCount(logStub, 8);
            });

            it('should send notifications for 7 http measurements: everything is high, no tls', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'http',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                rawHeaders: '',
                                rawBody: '',
                                truncated: false,
                                headers: {
                                    'some-header': 'some header value',
                                },
                                statusCode: 200,
                                statusCodeName: 'OK',
                                resolvedAddress: '',
                                timings: {
                                    total: 2000,
                                    dns: 153,
                                    tcp: 145,
                                    tls: 450,
                                    firstByte: 354,
                                    download: 388,
                                },
                                tls: null,
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);
                let messages = [
                    'Wachter :: notify(example.com) :: http :: the total HTTP request time is high 2000 ms',
                    'Wachter :: notify(example.com) :: http :: the time required to perform the DNS lookup is high 153 ms',
                    'Wachter :: notify(example.com) :: http :: the time from performing the DNS lookup to establishing the TCP connection is high 145 ms',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP connection to establishing the TLS session is high 450 ms',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP/TLS connection to the first response byte is high 354 ms',
                    'Wachter :: notify(example.com) :: http :: the time from the first response byte to downloading the entire response is high 388 ms',
                    'Wachter :: notify(example.com) :: http :: no TLS certificate is available',
                ];
                sinon.assert.calledWith(sendMessageStub.getCalls()[0], bot, messages[0], 2);
                sinon.assert.calledWith(sendMessageStub.getCalls()[1], bot, messages[1], 2);
                sinon.assert.calledWith(sendMessageStub.getCalls()[2], bot, messages[2], 2);
                sinon.assert.calledWith(sendMessageStub.getCalls()[3], bot, messages[3], 2);
                sinon.assert.calledWith(sendMessageStub.getCalls()[4], bot, messages[4], 2);
                sinon.assert.calledWith(sendMessageStub.getCalls()[5], bot, messages[5], 2);
                sinon.assert.calledWith(sendMessageStub.getCalls()[6], bot, messages[6], 1);
                sinon.assert.calledWith(logStub.getCalls()[1], messages[0], 2);
                sinon.assert.calledWith(logStub.getCalls()[2], messages[1], 2);
                sinon.assert.calledWith(logStub.getCalls()[3], messages[2], 2);
                sinon.assert.calledWith(logStub.getCalls()[4], messages[3], 2);
                sinon.assert.calledWith(logStub.getCalls()[5], messages[4], 2);
                sinon.assert.calledWith(logStub.getCalls()[6], messages[5], 2);
                sinon.assert.calledWith(logStub.getCalls()[7], messages[6], 1);

                sinon.assert.callCount(sendMessageStub, 7);
                sinon.assert.callCount(logStub, 8);
            });

            it('should send notifications for 7 http measurements: everything is very high, no tls', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'http',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                rawHeaders: '',
                                rawBody: '',
                                truncated: false,
                                headers: {
                                    'some-header': 'some header value',
                                },
                                statusCode: 200,
                                statusCodeName: 'OK',
                                resolvedAddress: '',
                                timings: {
                                    total: 6000,
                                    dns: 559,
                                    tcp: 645,
                                    tls: 750,
                                    firstByte: 754,
                                    download: 788,
                                },
                                tls: null,
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);
                let messages = [
                    'Wachter :: notify(example.com) :: http :: the total HTTP request time is very high 6000 ms',
                    'Wachter :: notify(example.com) :: http :: the time required to perform the DNS lookup is very high 559 ms',
                    'Wachter :: notify(example.com) :: http :: the time from performing the DNS lookup to establishing the TCP connection is very high 645 ms',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP connection to establishing the TLS session is very high 750 ms',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP/TLS connection to the first response byte is very high 754 ms',
                    'Wachter :: notify(example.com) :: http :: the time from the first response byte to downloading the entire response is very high 788 ms',
                    'Wachter :: notify(example.com) :: http :: no TLS certificate is available',
                ];
                sinon.assert.calledWith(sendMessageStub.getCalls()[0], bot, messages[0], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[1], bot, messages[1], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[2], bot, messages[2], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[3], bot, messages[3], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[4], bot, messages[4], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[5], bot, messages[5], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[6], bot, messages[6], 1);

                sinon.assert.calledWith(logStub.getCalls()[1], messages[0], 3);
                sinon.assert.calledWith(logStub.getCalls()[2], messages[1], 3);
                sinon.assert.calledWith(logStub.getCalls()[3], messages[2], 3);
                sinon.assert.calledWith(logStub.getCalls()[4], messages[3], 3);
                sinon.assert.calledWith(logStub.getCalls()[5], messages[4], 3);
                sinon.assert.calledWith(logStub.getCalls()[6], messages[5], 3);
                sinon.assert.calledWith(logStub.getCalls()[7], messages[6], 1);

                sinon.assert.callCount(sendMessageStub, 7);
                sinon.assert.callCount(logStub, 8);
            });

            it('should send notifications for 7 http measurements: timings null, with tls, the certificate is not authorized', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'http',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                rawHeaders: '',
                                rawBody: '',
                                truncated: false,
                                headers: {
                                    'some-header': 'some header value',
                                },
                                statusCode: 200,
                                statusCodeName: 'OK',
                                resolvedAddress: '',
                                timings: {
                                    total: null,
                                    dns: null,
                                    tcp: null,
                                    tls: null,
                                    firstByte: null,
                                    download: null,
                                },
                                tls: {
                                    authorized: false,
                                    error: 'some error',
                                    createdAt: 'date',
                                    expiresAt: 'date',
                                    subject: {
                                        CN: '',
                                        alt: '',
                                    },
                                    issuer: {
                                        C: '',
                                        O: '',
                                        CN: '',
                                    },
                                    keyType: 'RSA',
                                    keyBits: 123,
                                    serialNumber: '12345',
                                    fingerprint256: '48324',
                                    publicKey: '',
                                },
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');

                await Wachter.notify(bot, measurement);
                let messages = [
                    'Wachter :: notify(example.com) :: http :: the total HTTP request time is null',
                    'Wachter :: notify(example.com) :: http :: the time required to perform the DNS lookup is null',
                    'Wachter :: notify(example.com) :: http :: the time from performing the DNS lookup to establishing the TCP connection is null',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP connection to establishing the TLS session is null',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP/TLS connection to the first response byte is null',
                    'Wachter :: notify(example.com) :: http :: the time from the first response byte to downloading the entire response is null',
                    'Wachter :: notify(example.com) :: http :: the certificate is not authorized(some error)',
                ];
                sinon.assert.calledWith(sendMessageStub.getCalls()[0], bot, messages[0], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[1], bot, messages[1], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[2], bot, messages[2], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[3], bot, messages[3], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[4], bot, messages[4], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[5], bot, messages[5], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[6], bot, messages[6], 3);
                sinon.assert.calledWith(logStub.getCalls()[1], messages[0], 3);
                sinon.assert.calledWith(logStub.getCalls()[2], messages[1], 3);
                sinon.assert.calledWith(logStub.getCalls()[3], messages[2], 3);
                sinon.assert.calledWith(logStub.getCalls()[4], messages[3], 3);
                sinon.assert.calledWith(logStub.getCalls()[5], messages[4], 3);
                sinon.assert.calledWith(logStub.getCalls()[6], messages[5], 3);
                sinon.assert.calledWith(logStub.getCalls()[7], messages[6], 3);
            });

            it('should send notifications for 7 http measurements: timings null, with tls, the certificate is expired', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'http',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                rawHeaders: '',
                                rawBody: '',
                                truncated: false,
                                headers: {
                                    'some-header': 'some header value',
                                },
                                statusCode: 200,
                                statusCodeName: 'OK',
                                resolvedAddress: '',
                                timings: {
                                    total: null,
                                    dns: null,
                                    tcp: null,
                                    tls: null,
                                    firstByte: null,
                                    download: null,
                                },
                                tls: {
                                    authorized: true,
                                    error: '',
                                    createdAt: '',
                                    expiresAt: '2021-05-01T23:59:59.000Z',
                                    subject: {
                                        CN: '',
                                        alt: '',
                                    },
                                    issuer: {
                                        C: '',
                                        O: '',
                                        CN: '',
                                    },
                                    keyType: 'RSA',
                                    keyBits: 123,
                                    serialNumber: '12345',
                                    fingerprint256: '48324',
                                    publicKey: '',
                                },
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');
                const dateStub = sandbox.stub(Date, 'now').onCall(0).returns(1701610266385);

                await Wachter.notify(bot, measurement);
                let messages = [
                    'Wachter :: notify(example.com) :: http :: the total HTTP request time is null',
                    'Wachter :: notify(example.com) :: http :: the time required to perform the DNS lookup is null',
                    'Wachter :: notify(example.com) :: http :: the time from performing the DNS lookup to establishing the TCP connection is null',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP connection to establishing the TLS session is null',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP/TLS connection to the first response byte is null',
                    'Wachter :: notify(example.com) :: http :: the time from the first response byte to downloading the entire response is null',
                    'Wachter :: notify(example.com) :: http :: the certificate is expired(expiration date - 2021-05-01T23:59:59.000Z)',
                ];
                sinon.assert.calledWith(sendMessageStub.getCalls()[0], bot, messages[0], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[1], bot, messages[1], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[2], bot, messages[2], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[3], bot, messages[3], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[4], bot, messages[4], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[5], bot, messages[5], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[6], bot, messages[6], 3);

                sinon.assert.calledWith(logStub.getCalls()[1], messages[0], 3);
                sinon.assert.calledWith(logStub.getCalls()[2], messages[1], 3);
                sinon.assert.calledWith(logStub.getCalls()[3], messages[2], 3);
                sinon.assert.calledWith(logStub.getCalls()[4], messages[3], 3);
                sinon.assert.calledWith(logStub.getCalls()[5], messages[4], 3);
                sinon.assert.calledWith(logStub.getCalls()[6], messages[5], 3);
                sinon.assert.calledWith(logStub.getCalls()[7], messages[6], 3);

                sinon.assert.callCount(sendMessageStub, 7);
                sinon.assert.callCount(logStub, 8);
                sinon.assert.calledOnce(dateStub);
            });

            it('should send notifications for 7 http measurements: timings null, with tls, the certificate will expire in 20 days', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'http',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                rawHeaders: '',
                                rawBody: '',
                                truncated: false,
                                headers: {
                                    'some-header': 'some header value',
                                },
                                statusCode: 200,
                                statusCodeName: 'OK',
                                resolvedAddress: '',
                                timings: {
                                    total: null,
                                    dns: null,
                                    tcp: null,
                                    tls: null,
                                    firstByte: null,
                                    download: null,
                                },
                                tls: {
                                    authorized: true,
                                    error: '',
                                    createdAt: '',
                                    expiresAt: '2021-05-01T23:59:59.000Z',
                                    subject: {
                                        CN: '',
                                        alt: '',
                                    },
                                    issuer: {
                                        C: '',
                                        O: '',
                                        CN: '',
                                    },
                                    keyType: 'RSA',
                                    keyBits: 123,
                                    serialNumber: '12345',
                                    fingerprint256: '48324',
                                    publicKey: '',
                                },
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');
                const dateStub = sandbox.stub(Date, 'now').onCall(0).returns(1618182599000);

                await Wachter.notify(bot, measurement);
                let messages = [
                    'Wachter :: notify(example.com) :: http :: the total HTTP request time is null',
                    'Wachter :: notify(example.com) :: http :: the time required to perform the DNS lookup is null',
                    'Wachter :: notify(example.com) :: http :: the time from performing the DNS lookup to establishing the TCP connection is null',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP connection to establishing the TLS session is null',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP/TLS connection to the first response byte is null',
                    'Wachter :: notify(example.com) :: http :: the time from the first response byte to downloading the entire response is null',
                    'Wachter :: notify(example.com) :: http :: the certificate will expire in 20 days, 0 hours',
                ];
                sinon.assert.calledWith(sendMessageStub.getCalls()[0], bot, messages[0], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[1], bot, messages[1], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[2], bot, messages[2], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[3], bot, messages[3], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[4], bot, messages[4], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[5], bot, messages[5], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[6], bot, messages[6], 2);

                sinon.assert.calledWith(logStub.getCalls()[1], messages[0], 3);
                sinon.assert.calledWith(logStub.getCalls()[2], messages[1], 3);
                sinon.assert.calledWith(logStub.getCalls()[3], messages[2], 3);
                sinon.assert.calledWith(logStub.getCalls()[4], messages[3], 3);
                sinon.assert.calledWith(logStub.getCalls()[5], messages[4], 3);
                sinon.assert.calledWith(logStub.getCalls()[6], messages[5], 3);
                sinon.assert.calledWith(logStub.getCalls()[7], messages[6], 2);

                sinon.assert.callCount(sendMessageStub, 7);
                sinon.assert.callCount(logStub, 8);
                sinon.assert.calledOnce(dateStub);
            });

            it('should send notifications for 7 http measurements: timings null, with tls, the certificate will expire in a few hours', async () => {
                const bot = {} as Telegraf;
                let measurement: MeasurementGetResponseBody = {
                    id: '123',
                    target: 'example.com',
                    type: 'http',
                    status: 'finished',
                    createdAt: '2024-10-10',
                    updatedAt: '2024-10-10',
                    probesCount: 1,
                    results: [
                        {
                            probe: {
                                continent: 'SA',
                                region: 'South America',
                                country: 'US',
                                state: null,
                                city: 'Example city',
                                asn: 123,
                                network: 'string',
                                latitude: 4234.2,
                                longitude: 4234.2,
                                resolvers: ['', ''],
                            },
                            result: {
                                status: 'finished',
                                rawOutput: '',
                                rawHeaders: '',
                                rawBody: '',
                                truncated: false,
                                headers: {
                                    'some-header': 'some header value',
                                },
                                statusCode: 200,
                                statusCodeName: 'OK',
                                resolvedAddress: '',
                                timings: {
                                    total: null,
                                    dns: null,
                                    tcp: null,
                                    tls: null,
                                    firstByte: null,
                                    download: null,
                                },
                                tls: {
                                    authorized: true,
                                    error: '',
                                    createdAt: '',
                                    expiresAt: '2021-05-01T23:59:59.000Z',
                                    subject: {
                                        CN: '',
                                        alt: '',
                                    },
                                    issuer: {
                                        C: '',
                                        O: '',
                                        CN: '',
                                    },
                                    keyType: 'RSA',
                                    keyBits: 123,
                                    serialNumber: '12345',
                                    fingerprint256: '48324',
                                    publicKey: '',
                                },
                            },
                        },
                    ],
                };

                const sendMessageStub = sandbox.stub(telegram, 'sendMessage');
                const logStub = sandbox.stub(utils, 'log');
                const dateStub = sandbox.stub(Date, 'now').onCall(0).returns(1619900599000);

                await Wachter.notify(bot, measurement);
                let messages = [
                    'Wachter :: notify(example.com) :: http :: the total HTTP request time is null',
                    'Wachter :: notify(example.com) :: http :: the time required to perform the DNS lookup is null',
                    'Wachter :: notify(example.com) :: http :: the time from performing the DNS lookup to establishing the TCP connection is null',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP connection to establishing the TLS session is null',
                    'Wachter :: notify(example.com) :: http :: the time from establishing the TCP/TLS connection to the first response byte is null',
                    'Wachter :: notify(example.com) :: http :: the time from the first response byte to downloading the entire response is null',
                    'Wachter :: notify(example.com) :: http :: the certificate will expire in 0 days, 3 hours',
                ];
                sinon.assert.calledWith(sendMessageStub.getCalls()[0], bot, messages[0], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[1], bot, messages[1], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[2], bot, messages[2], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[3], bot, messages[3], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[4], bot, messages[4], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[5], bot, messages[5], 3);
                sinon.assert.calledWith(sendMessageStub.getCalls()[6], bot, messages[6], 3);

                sinon.assert.calledWith(logStub.getCalls()[1], messages[0], 3);
                sinon.assert.calledWith(logStub.getCalls()[2], messages[1], 3);
                sinon.assert.calledWith(logStub.getCalls()[3], messages[2], 3);
                sinon.assert.calledWith(logStub.getCalls()[4], messages[3], 3);
                sinon.assert.calledWith(logStub.getCalls()[5], messages[4], 3);
                sinon.assert.calledWith(logStub.getCalls()[6], messages[5], 3);
                sinon.assert.calledWith(logStub.getCalls()[7], messages[6], 3);

                sinon.assert.callCount(sendMessageStub, 7);
                sinon.assert.callCount(logStub, 8);
                sinon.assert.calledOnce(dateStub);
            });
        });
    });
});
