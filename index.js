
// ==============Developed by==================
//       ___           ___                 
//      /\__\         /\  \          ___   
//     /:/  /        /::\  \        /\  \  
//    /:/__/        /:/\:\  \       \:\  \ 
//   /::\__\____   /:/  \:\  \      /::\__\
//  /:/\:::::\__\ /:/__/ \:\__\  __/:/\/__/
//  \/_|:|~~|~    \:\  \ /:/  / /\/:/  /   
//     |:|  |      \:\  /:/  /  \::/__/    
//     |:|  |       \:\/:/  /    \:\__\    
//     |:|  |        \::/  /      \/__/    
//      \|__|         \/__/                
// ===========================================




global.AbortController = require("node-abort-controller").AbortController;
const { Client, Intents, MessageEmbed } = require('discord.js'), { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, VoiceConnectionStatus, AudioPlayerStatus } = require('@discordjs/voice'), config = require('./config.json');
const bot = new Client(config.cfg);
bot.login(config.token);
const ytdl = require('ytdl-core');
const yts = require('yt-search');
const eventEmitter = require('events');
const event = new eventEmitter();
const mysql = require('mysql');

const database = mysql.createConnection({
    host: config.mysql_host,
    user: config.mysql_user,
    password: config.mysql_pass,
    database: config.mysql_db,
    charset: `utf8mb4`
});
database.connect(function (err) {
    if (err) {
        console.log(`[Client] Database connection error. Try again`)
        console.log(err.name)
        console.log(err)
        console.log(`---------------`)
        process.exit(143);
    } else {
        console.log(`[Client] Successfully connected to the database!`)
        database.query("SET SESSION wait_timeout = 604800");
    }
});

var queue = [];
var currentSong = 0;
var channel;
var connection;
bot.on(`ready`, async () => {
    channel = await bot.channels.cache.get(`946804103005241434`);
    connection = await connectToChannel(channel);

    database.query(`SELECT * FROM \`queue\` WHERE 1`, async (err, result) => {
        if (err) return console.log(err);
        if (result.length == 0) return;

        for await (let res of result) {
            queue.push(res.song);
        }
        play({
           channel: channel,
           song: queue[0]
        });
    });
})

bot.on(`messageCreate`, async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith(`/add`)) {
        const args = message.content.split(` `);
        if (!args[1]) return;
        if (queue.length == 0) play({
           channel: channel,
           song: args[1]
        });
        queue.push(args[1]);
        database.query(`INSERT INTO \`queue\` (\`song\`) VALUES ('${args[1]}')`);
        message.delete();
    }
    if (message.content.startsWith(`/remove`)) {
        const args = message.content.split(` `);

        if (!args[1]) return;

        database.query(`SELECT * FROM \`queue\` WHERE \`id\` = '${args[1]}'`, async (err, result) => {
            if (err) return console.log(err);
            if (result.length == 0) return;

            let index = queue.indexOf(result[0].song);
            if (index != -1) queue.splice(index, 1);
            database.query(`DELETE FROM \`queue\` WHERE \`id\` = '${args[1]}'`);
            message.delete();
        });
    }
    if (message.content == `/checkpl`) {
        message.delete();

        database.query(`SELECT * FROM \`queue\` WHERE 1`, async (err, result) => {
            if (err) return console.log(err);
            if (result.length == 0) return;

            let tracks = result.map(m => `${m.id}. ${m.song}\n`);
            const embed = new MessageEmbed()
                .setTitle(`Tracks`)
                .setDescription(`${tracks.toString().replaceAll(`,`, ``)}`)

            message.channel.send({
                embeds: [embed]
            })
        });
    }
    if (message.content == `/next`) {
        if (queue.length < 2) return;
        message.delete();
        currentSong++;
        if (currentSong < queue.length) play({
           channel: channel,
           song: queue[currentSong]
        });
        else {
            currentSong = 0;
            play({
               channel: channel,
               song: queue[0]
            });
        }
    }
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function connectToChannel(channel) {
    return new Promise(async(resolve, reject) => {
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false
        });
        connection.once(VoiceConnectionStatus.Ready, () => {
            resolve(connection)
        })
        await delay(30000)
        reject('Connection was failed to connect to VC')
    })
}

async function play(options = {}) {
    const { channel, song } = options;
    if(!channel || channel?.type !== 'GUILD_VOICE') return console.log(`INVALID_VOICE_CHANNEL: There is no valid VoiceChannel provided.`);
    if(!song || typeof song !== 'string') return console.log(`INVALID_MUSIC_URL: There is no valid Music URL provided.`);

    let queueSongInfo;
    const songInfo = (await yts(song)).all.filter(ch => ch.type === 'video' || ch.type === 'list')[0];
    if(!songInfo) return console.log(`NO_SONG: There was no song found with the name/URL '${song}'.`);
    else {
        const ytdlSongInfo = await ytdl.getInfo(songInfo.url);
        queueSongInfo = {
            title: songInfo.title,
            description: songInfo.description,
            duration: songInfo.timestamp,
            views: songInfo.views,
            author: songInfo.author.name,
            url: songInfo.url,
            thumbnail: songInfo.thumbnail,
            likes: ytdlSongInfo.videoDetails.likes,
            dislikes: ytdlSongInfo.videoDetails.dislikes,
            extra: {
                type: 'video',
                playlist: null
            }
        };
    };
    playSong(song);
}
async function playSong(url) {
    console.log(url)
    let resource = await createAudioResource(ytdl(url, { filter: 'audioonly' }), { 
        inputType: StreamType.Arbitrary,
        inlineVolume: true
    });
    const player = createAudioPlayer();
    player.play(resource);
    await connection.subscribe(player)

    event.emit('playSong', channel);

    player.on(AudioPlayerStatus.Playing, () => {
        
    });

    player.on(AudioPlayerStatus.Idle, async () => {
        currentSong++;
        if (currentSong < queue.length) play({
           channel: channel,
           song: queue[currentSong]
        });
        else {
            currentSong = 0;
            play({
               channel: channel,
               song: queue[0]
            });
        }
    });
    
    player.on('error', err => console.log(err))
};