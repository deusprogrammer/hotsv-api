import { spawn } from 'child_process';
import Express from 'express';

const router = Express.Router();

const dungeons = {};

router.post('/', (req, res) => {
    const { owner } = req.body;
    let process = spawn('node', ['src/game.js', owner], {});

    process.stdout?.on('data', (data) => {
        console.log(`dm-${owner}-stdout: ${data}`);
    });

    // Handle the child process's stderr data
    process.stderr?.on('data', (data) => {
        console.error(`dm-${owner}-stderr: ${data}`);
    });

    // Handle the child process's exit event
    process.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
    });

    dungeons[owner] = process;
    return res.status(201).send();
});

router.delete('/:channelId', (req, res) => {
    const { channelId } = req.params;
    dungeons[channelId]?.kill('SIGKILL');
    delete dungeons[channelId];
    return res.status(200).send();
});

export default router;
