module.exports = {
    apps: [
        {
            name: "uptime-wachter",
            script: "./dist/index.js",
            args: "max-old-space-size=4096",
            watch: false,
            error_file: "./logs/errors.log",
            out_file: "./logs/out.log",
            autorestart: true,
            log_date_format: "YYYY-MM-DD HH:mm Z"
        }
    ]
}
