const { Client, Intents, MessageActionRow, MessageButton, MessageEmbed } = require('discord.js');
//const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');

// https://discord.com/developers/applications/
// https://discord.js.org/#/docs/main/stable/class/TextChannel?scrollTo=send
// https://discordjs.guide/creating-your-bot/event-handling.html

// Note: i originally implemented the webhook version of this, but i want more interaction
// (specifically, two-way). Therefore a full bot ("application") is being used.

// Members of channels. Because of roles & private channels etc, not all guild members are in every guild channel.
// but much of discord's API makes it hard to track this. For example there is no "member joined a channel" event,
// there's just "joined guild", and it's not specified whether the user will appear in channels during this event.

// Thus in order to emit proper join/part events, i must keep my own track of channel - user mappings.

// this class does the actual interaction with discord, receiving events, tracking some state,
// and wrapping methods to send messages. It also wraps the oddities of discord API for example trying to
// put users in channels during events rather than guild-global.
class DiscordBot {

    constructor(gConfig, initProc) {

        this.gConfig = gConfig;
        this.EventHook = {};
        this.initProc = initProc;

        // don't bother looking at channels we don't have integrations with.
        this.relevantChannelIDs = {}; // map channelID to array of member IDs.
        Object.values(gConfig.discord_subscriptions).forEach(s => {
            this.relevantChannelIDs[s.discord_channel_id] = new Set();
        });

        this.client = new Client({ intents: [
            Intents.FLAGS.GUILDS,
            Intents.FLAGS.GUILD_MESSAGES,
            Intents.FLAGS.DIRECT_MESSAGES,
            Intents.FLAGS.GUILD_MEMBERS,
            Intents.FLAGS.GUILD_VOICE_STATES,
        ] });

        // When the client is ready, run this code (only once)
        this.client.once('ready', async () => {
            await this.FetchAndDump();
            this.SyncChannelUserMap();
        }); // ready()

        this.client.on('messageCreate', (message) => {
            try {
                if (!(message.channelId in this.relevantChannelIDs))
                    return;
                //console.log(`DISCORD: #${message.channel.name} <${message.member.displayName}> ${this.DiscordMessageToString(message)}`);
                this.EventHook?.OnDiscordMessage?.(message);
            } catch (e) {
                console.log(`Exception in discord client event messageCreate`);
                console.log(e);
            }
        });

        this.client.on('guildMemberAdd', (member) => {
            //console.log(`-------------------------------------`);
            //console.log(`user added ${member.displayName}`);
            try {
                const channels = this.GetChannelsForMember(member);

                // add to our channel user map and emit join events
                const emits = [];
                channels.forEach(channel => {
                    if (!(channel.id in this.relevantChannelIDs))
                        return;
                    //console.log(`  => in channel ${channel.id} ${channel.name}`);
                    relevantChannelIDs[channel.id].add(member.id);
                    emits.push(channel);
                });

                emits.forEach(channel => {
                    this.EventHook?.OnDiscordMemberJoin?.(
                        channel,
                        member,
                    );
                });
            } catch (e) {
                console.log(`Exception in discord client event guildMemberAdd`);
                console.log(e);
            }
        });
        
        this.client.on('guildMemberRemove', (member) => {
            //console.log(`-------------------------------------`);
            //console.log(`user removed ${member.displayName}`);
            try {
                // remove from our map
                const emits = [];
                Object.keys(this.relevantChannelIDs).forEach(channelID => {
                    if (this.relevantChannelIDs[channelID].delete(member.id)) {
                        emits.push(channelID);
                    }
                });

                emits.forEach(channelID => {
                    this.EventHook?.OnDiscordMemberPart?.(
                        this.client.channels.cache.get(channelID),
                        member,
                    );
                });
            } catch (e) {
                console.log(`Exception in discord client event guildMemberRemove`);
                console.log(e);
            }
        });

        this.client.on('channelUpdate', (member) => {
            //console.log(`-------------------------------------`);
            //console.log(`channelUpdate ${member}`);
            try {
                // Many users may enter or leave, as the result of channel permission updates. Best to rebuild the map.
                this.SyncChannelUserMap();
            } catch (e) {
                console.log(`Exception in discord client event channelUpdate`);
                console.log(e);
            }

            //this.CachedDumpAllChannels();
        });

        this.client.on('guildMemberUpdate', (oldMember, newMember) => {
            //console.log(`-------------------------------------`);
            //console.log(`guildMemberUpdate ${oldMember.displayName} => ${newMember.displayName}`);
            try {
                // user role changes can implicitly join/part them from rooms. rebuild our map
                this.SyncChannelUserMap();

                this.EventHook?.OnDiscordMemberUpdate?.(
                    oldMember,
                    newMember,
                );
            } catch (e) {
                console.log(`Exception in discord client event channelUpdate`);
                console.log(e);
            }
        });

        try {
            this.client.login(gConfig.discord_bot_token);
        }
        catch (e) {
            console.log(`Couldn't connect to discord ...`);
            console.log(e);
        }
    }; // ctor

    GetDebugData() {
        return {
            "guilds": this.client.guilds.cache.map(g => ({
                name: g.name,
                id: g.id,
                channels: g.channels.cache.filter(ch => ch.type === 'GUILD_TEXT').map(ch => ({
                    name: ch.name,
                    id: ch.id,
                    type: ch.type,
                }))
            }))
        };
     }

     GetAdminDumpObject() {
         return this.GetDebugData();
     }

    CachedDumpAllChannels() {
        //console.log(`-- CachedDumpAllChannels ------------`);
        //const startTime = Date.now();
        this.client.channels.cache.forEach(channel => {
            if (!(channel.id in this.relevantChannelIDs))
                return;
            console.log(`${channel.name} / ${channel.id}`);
            channel.members.forEach(member => {
                console.log(`  ${member.displayName}`);
            });
        });
        //console.log(`> CachedDumpAllChannels (${Date.now() - startTime} ms)`);
    }

    GetChannelsForMember(member) {
        //console.log(`-- GetChannelsForMember ------------`);
        //const startTime = Date.now();
        const ret = [];
        this.client.channels.cache.forEach(channel => {
            if (!(channel.id in this.relevantChannelIDs))
                return;
            if (channel.members.has(member.id)) {
                ret.push(channel);
            }
        });
        //console.log(`> GetChannelsForMember (${Date.now() - startTime} ms)`);
        return ret;
    }

    // https://2ality.com/2015/01/es6-set-operations.html
    // a minus b
    SetDiff(a, b) {
        return new Set([...a].filter(x => !b.has(x)));            
    }

    ReannounceUserMapTo7jam() {
        Object.values(this.relevantChannelIDs).forEach(s => s.clear());
        this.SyncChannelUserMap();
    }

    SyncChannelUserMap() {
        //console.log(`-- SyncChannelUserMap ------------`);
        const startTime = Date.now();
        // create & populate a new empty map.
        const newMap = {};
        let joins = []; // { channel, member }
        let parts = []; // { channel, memberID }
        Object.keys(this.relevantChannelIDs).forEach(channelID => {
            const channel = this.client.channels.cache.get(channelID);
            const newMemberSet = new Set([...channel.members.values()]
                .filter(member => {
                    return this.IsMemberValidForIntegration(member);
                })
                .map(member => member.id)
                );
            newMap[channelID] = newMemberSet;
            const oldMemberList = this.relevantChannelIDs[channelID];

            // calculate joins (in new but not in old)
            const joinedMemberIDs = this.SetDiff(newMemberSet, oldMemberList); // set.
            joins = joins.concat([...joinedMemberIDs].map(memberID => {
                const member = channel.members.get(memberID);
                return {
                    channel,
                    member,
                };
            }));

            // find parts (in old but not new)
            const partedMemberIDs = this.SetDiff(oldMemberList, newMemberSet); // set.
            parts = parts.concat([...partedMemberIDs].map(memberID => {
                return {
                    channel,
                    memberID,
                };
            }));
        });

        this.relevantChannelIDs = newMap;

        joins.forEach(o => {
            //console.log(`7jam discord user join: #${o.channel.name} += ${o.member.displayName}`);
            this.EventHook?.OnDiscordMemberJoin?.(
                o.channel,
                o.member,
            );
        });

        parts.forEach(o => {
            //console.log(`7jam discord user part: #${o.channel.name} -= ${o.memberID}`);
            this.EventHook?.OnDiscordMemberPart?.(
                o.channel,
                o.memberID,
            );
        });

        console.log(`SyncChannelUserMap took (${Date.now() - startTime} ms), with ${joins.length} joins & ${parts.length} parts`);

        // first channel sync, run init routine.
        if (this.initProc) {
            this.initProc();
            this.initProc = null;
        }
    }

    async FetchAndDump() {
        console.log(`< Dumping discord info`);
        const newData = {};
        const startTime = Date.now();
        const guildIDs = await this.client.guilds.fetch();
        const myGuildIDs = [];
        guildIDs.forEach(g => {
            myGuildIDs.push(g.id);
        });
        for (let i = 0; i < myGuildIDs.length; ++ i)  {
            const guild = await this.client.guilds.fetch(myGuildIDs[i]);
            const members = await guild.members.fetch();
            const channels = await guild.channels.fetch(); // parallel would be better but meh
            channels.forEach((channel, id) => {
                if (channel.type === 'GUILD_CATEGORY')
                    return;
                // if (!(channel.id in this.relevantChannelIDs))
                //     return;
                console.log(`${guild.name} / ${channel.name} [Guild.id ${channel.guildId} Channel.id ${id} type:${channel.type}]`);
                let count = 0;
                let skipped = 0;
                const maxCount = this.gConfig.discord_log_member_count ?? 5;
                channel.members.forEach(m => {
                    if (count >= maxCount) {
                        skipped ++;
                        return;
                    }
                    console.log(`  ${m.displayName} [memberid ${m.id}, userTag ${m.user.tag} deleted=${m.deleted} bot=${m.user.bot}`);
                    count ++;
                });
                if (skipped > 0) {
                    console.log(`  ... (+ ${skipped} members)`);
                }
            });
        }
        console.log(`> (${Date.now() - startTime} ms)`);
    }

    // bots, self, deleted users, and in the future, maybe this can be role-based.
    IsMemberValidForIntegration(member) {
        if (member.deleted) return false;
        // if (!member.user) {
        //     console.log(`brk`);
        // }
        if (member.user.bot) return false;
        return true;
    }

    DiscordMessageToString(message) {
        // message.stickers is an array of sticker IDs. let's ignore them.
        // message.embeds *tend* to be included in content. for example a youtube embed is normally an accompaniment to a text url in content. so i think for now we can ignore it.
        // message.attachments
        // cleanContent makes prettier mentions.
        // emoji will appear like this though:
        // "cleanContent": "<:kyorolove:864485608944304168>"
        return message.cleanContent;
    }

    async SendDiscordEmbedMessage(channelID, url, title, fields) {
        // https://discordjs.guide/popular-topics/embeds.html#embed-preview

        fields = fields || {};

        // this will send an embed-style message, which i think is technically the right thing to do for most notifications.
        const embeds = new MessageEmbed()
            .setColor('#00cccc')
            .setURL(url)

        // if (text) {
        //     embeds.setDescription(text)
        // }
        if (title) {
            embeds.setTitle(title)
        }
        
        Object.keys(fields).forEach(k => {
            embeds.addField(k, `[${fields[k]}](${url})`, true);
        });

        this.client.channels.cache.get(channelID)?.send({ embeds: [embeds] });
    }

    async SendDiscordChatMessage(channelID, userName, text, url, roomName) {
        // https://discordjs.guide/popular-topics/embeds.html#embed-preview
        const content = `${roomName}: <${userName}> ${text}`;
        const chan = this.client.channels.cache.get(channelID);

        chan?.send(content);
    }

};

module.exports = {
    DiscordBot
}
