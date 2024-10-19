import { createWorker, log } from './utils';
import config from './config';

(async () => {
    try {
        log(`worker spawned`, 3);
        let worker = await createWorker('./dist/worker.js', {}, config);
        log(`worker gracefully exited with message: ${worker}`, 3);
    } catch (e: any) {
        log(`error occurred: ${e.message}`, 3);
    }
})();
