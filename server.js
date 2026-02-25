#!/usr/bin/env node

const inquirer = require("inquirer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
const chalk = require("chalk");
const pLimit = require("p-limit");

ffmpeg.setFfmpegPath(ffmpegPath);

const CONCURRENT_DOWNLOADS = 10;

async function askUrl() {
    const { url } = await inquirer.prompt([
        {
            type: "input",
            name: "url",
            message: "📡 Enter M3U8 URL:",
            validate: v => v.startsWith("http") || "Invalid URL"
        }
    ]);

    return url;
}

/* -------------------- GET BEST QUALITY -------------------- */

async function getBestStream(url) {
    console.log(chalk.cyan("\n🔍 Fetching playlist..."));

    const res = await axios.get(url);
    const data = res.data;

    // If master playlist → choose highest resolution
    if (data.includes("#EXT-X-STREAM-INF")) {
        const lines = data.split("\n");

        let best = { bandwidth: 0, uri: null };

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes("#EXT-X-STREAM-INF")) {
                const bandwidthMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;

                const uri = lines[i + 1]?.trim();

                if (bandwidth > best.bandwidth) {
                    best = { bandwidth, uri };
                }
            }
        }

        if (best.uri) {
            const bestUrl = new URL(best.uri, url).toString();
            console.log(chalk.green("✅ Best quality selected"));
            return bestUrl;
        }
    }

    return url;
}

/* -------------------- DOWNLOAD SEGMENTS CONCURRENTLY -------------------- */

async function downloadSegments(url, outputDir) {
    const res = await axios.get(url);
    const playlist = res.data;

    const segments = playlist
        .split("\n")
        .filter(l => l && !l.startsWith("#"));

    if (!segments.length) throw new Error("No segments found.");

    console.log(chalk.green(`✅ Found ${segments.length} segments`));

    const segmentDir = path.join(outputDir, "segments");
    fs.mkdirSync(segmentDir, { recursive: true });

    let downloaded = 0;
    let totalBytes = 0;
    let startTime = Date.now();

    const limit = pLimit(CONCURRENT_DOWNLOADS);

    await Promise.all(
        segments.map((seg, index) =>
            limit(async () => {
                const segmentUrl = new URL(seg, url).toString();
                const segmentPath = path.join(segmentDir, `seg${index}.ts`);

                const response = await axios({
                    url: segmentUrl,
                    method: "GET",
                    responseType: "arraybuffer"
                });

                const buffer = Buffer.from(response.data);
                fs.writeFileSync(segmentPath, buffer);

                downloaded++;
                totalBytes += buffer.length;

                const elapsed = (Date.now() - startTime) / 1000;
                const speed = (totalBytes / 1024 / 1024 / elapsed).toFixed(2);

                process.stdout.write(
                    `\r⬇ Downloading ${downloaded}/${segments.length} | ` +
                    `${speed} MB/s`
                );
            })
        )
    );

    console.log("\n✅ All segments downloaded.");
    return segmentDir;
}

/* -------------------- MERGE TO MP4 -------------------- */

function mergeSegments(segmentDir, outputFile) {
    console.log(chalk.yellow("\n⚙ Merging → MP4..."));

    const files = fs
        .readdirSync(segmentDir)
        .filter(f => f.endsWith(".ts"))
        .sort()
        .map(f => path.join(segmentDir, f));

    return new Promise((resolve, reject) => {
        const command = ffmpeg();

        files.forEach(file => command.input(file));

        command
            .on("progress", progress => {
                if (progress.percent) {
                    process.stdout.write(
                        `\r🔄 Converting: ${progress.percent.toFixed(2)}%`
                    );
                }
            })
            .on("end", () => {
                console.log("\n✅ Conversion Complete!");
                resolve();
            })
            .on("error", err => reject(err))
            .mergeToFile(outputFile, segmentDir);
    });
}

/* -------------------- CREATE DOWNLOAD LINK -------------------- */

function showLink(filePath) {
    const absolute = path.resolve(filePath);
    console.log("\n🎉 DONE!");
    console.log(chalk.green(`file://${absolute}`));
    console.log("👉 Ctrl + Click to open.");
}

/* -------------------- MAIN -------------------- */

async function main() {
    console.clear();
    console.log(chalk.magenta.bold("\n=== FAST M3U8 → MP4 CONVERTER ===\n"));

    try {
        const url = await askUrl();
        const bestUrl = await getBestStream(url);

        const outputDir = path.join(process.cwd(), "output");
        fs.mkdirSync(outputDir, { recursive: true });

        const segmentDir = await downloadSegments(bestUrl, outputDir);

        const outputFile = path.join(outputDir, "video.mp4");

        await mergeSegments(segmentDir, outputFile);

        showLink(outputFile);
    } catch (err) {
        console.error(chalk.red("\n❌ Error:"), err.message);
    }
}

main();
