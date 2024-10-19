import { resolve } from 'path';
import * as dotenv from 'dotenv';

let cfg = dotenv.config({
    path: resolve(__dirname, '../.env'),
});

export default cfg.parsed ?? {};
