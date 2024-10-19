import { MeasurementRequestBody } from 'globalping-ts';

export interface Measurement extends MeasurementRequestBody {
    cronExpression: string;
}

export type RemoveProperty<T, K extends keyof T> = {
    [P in Exclude<keyof T, K>]: T[P];
};
