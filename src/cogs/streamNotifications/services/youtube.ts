import { IStreamingService, IStreamingServiceStreamer, IStreamStatus, StreamingServiceError } from "../baseService";
import { IEmbed, escapeDiscordMarkdown } from "../../utils/utils";
import { default as fetch } from "node-fetch";

const MAX_STREAM_CACHE_LIFE = 180000;
const MAX_CHANNEL_CACHE_LIFE = 600000;  // ms
const YOUTUBE_ICON = "https://i.imgur.com/7Li5Iu2.png";
const YOUTUBE_COLOR = 0xCD201F;
// const YOUTUBE_ID_REGEXP = /^[a-zA-Z0-9\_\-]{23,26}$/;

class TwitchStreamingService implements IStreamingService {
    public name = "youtube";

    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    private streamsCache = new Map<string, {
        cachedAt: number,
        value: IYouTubeVideo
    }>();

    private channelCache = new Map<string, {
        cachedAt: number,
        value: IYouTubeChannel
    }>();

    public async fetch(streamers: IStreamingServiceStreamer[]) {
        // should return only online streams

        // don't updating for cached streams
        let reqDate = Date.now();
        let notCachedYet = streamers.filter(s => {
            // is not cached?
            let cached = this.streamsCache.get(s.uid);
            if(!cached) { return true; }
            if((reqDate - cached.cachedAt) > MAX_STREAM_CACHE_LIFE) { return true; }
            return false;
        });

        let result: IStreamStatus[] = [];

        for(let streamer of notCachedYet) {
            let resp = await fetch(this.getAPIURL_Stream(streamer.uid));
            if(resp.status !== 200) { continue; }
            let vids = (await resp.json()) as IYouTubeListResponse<IYouTubeVideo>;
            if(vids.items.length !== 1) { continue; }
            this.streamsCache.set(streamer.uid, {
                cachedAt: Date.now(),
                value: vids.items[0]
            });
        }

        for(let streamer of streamers) {
            let cached = this.streamsCache.get(streamer.uid);
            if(!cached || !cached.value) {
                result.push({
                    status: "offline",
                    id: "",
                    streamer
                });
                continue;
            }
            result.push({
                status: "online",
                streamer,
                id: cached.value.id.videoId
            });
        }

        return result;
    }

    public async getEmbed(stream: IStreamStatus, lang: string): Promise<IEmbed> {
        let cachedStream = this.streamsCache.get(stream.streamer.uid);
        if(!cachedStream) { throw new StreamingServiceError("YOUTUBE_CACHENOTFOUND", "Cache for channel not found"); }
        let cachedChannel = this.channelCache.get(stream.streamer.uid);
        if(!cachedChannel || ((Date.now() - cachedChannel.cachedAt) > MAX_CHANNEL_CACHE_LIFE)) {
            let resp = await fetch(this.getAPIURL_Channels(stream.streamer.uid, false));
            if(resp.status !== 200) {
                throw new StreamingServiceError("YOUTUBE_CHANNELFETCH_FAILED", "Fething failed");
            }
            let channels = ((await resp.json()) as IYouTubeListResponse<IYouTubeChannel>).items;
            if(channels.length !== 1) {
                throw new StreamingServiceError("YOUTUBE_CHANNELNOTFOUND", "Channel not found");
            }
            this.channelCache.set(stream.streamer.uid, {
                cachedAt: Date.now(),
                value: channels[0]
            });
            cachedChannel = this.channelCache.get(stream.streamer.uid) as {
                cachedAt: number,
                value: IYouTubeChannel
            };
        }

        if(!cachedChannel) { throw new StreamingServiceError("YOUTUBE_CODEERROR", "Error in caching code. Something went wrong"); }

        let channel = cachedChannel.value;

        return {
            footer: {
                icon_url: YOUTUBE_ICON,
                text: "YouTube"
            },
            thumbnail: {
                url: channel.snippet.thumbnails.high.url,
                width: 128,
                height: 128
            },
            timestamp: cachedStream.value.snippet.publishedAt,
            author: {
                icon_url: channel.snippet.thumbnails.default.url,
                name: channel.snippet.title,
                url: channel.snippet.customUrl
            },
            description: localizer.getFormattedString(lang, "STREAMING_DESCRIPTION", {
                username: escapeDiscordMarkdown(channel.snippet.title, true)
            }),
            color: YOUTUBE_COLOR,
            image: {
                url: cachedStream.value.snippet.thumbnails.high.url
            }
        };
    }

    private getAPIURL_Stream(channelId: string) {
        let str = "https://www.googleapis.com/youtube/v3/search";
        str += "?part=snippet";
        str += `&channelId=${channelId}`;
        str += "&type=video";
        str += "&eventType=live";
        str += `&key=${this.apiKey}`;
        return str;
    }

    private getAPIURL_Channels(id: string, isUsername = false) {
        let str = "https://www.googleapis.com/youtube/v3/channels";
        str += isUsername ? `?forUsername=${id}` : `?id=${id}`;
        str += "&part=snippet";
        str += `&key=${this.apiKey}`;
        return str;
    }

    public freed(uid: string) {
        this.streamsCache.delete(uid);
        this.channelCache.delete(uid);
    }

    public async getStreamer(username: string): Promise<IStreamingServiceStreamer> {
        let isId = username.startsWith("channel/");
        if(isId) {
            username = username.slice("channel/".length);
        }

        let resp = await fetch(this.getAPIURL_Channels(username, !isId));

        if(resp.status !== 200) {
            throw new StreamingServiceError("YOUTUBE_UNSUCCESSFUL_RESP", "YouTube respond with wrong code, means");
        }

        let channels = ((await resp.json()) as IYouTubeListResponse<IYouTubeChannel>).items;

        if(channels.length !== 1) {
            throw new StreamingServiceError("YOUTUBE_USERNOTFOUND", "User not found.");
        }
        let channel = channels[0];

        this.channelCache.set(channel.id, {
            cachedAt: Date.now(),
            value: channel
        });

        return {
            serviceName: this.name,
            uid: channel.id,
            username: channel.snippet.title
        };
    }

    async unload() {
        this.channelCache.clear();
        this.streamsCache.clear();
        return true;
    }
}

interface IYouTubeChannel {
    "kind": string;
    "etag": string;
    "id": string;
    "snippet": {
        "title": string;
        "description": string;
        "customUrl": string;
        "publishedAt": string;
        "thumbnails": {
            "default": {
                "url": string;
            };
            "medium": {
                "url": string;
            };
            "high": {
                "url": string;
            };
        };
        "localized": {
            "title": string;
            "description": string;
        };
    };
}

interface IYouTubeListResponse<T> {
    "kind": string;
    "pageInfo": {
        "totalResults": number;
        "resultsPerPage": number;
    };
    "items": T[];
}

interface IYouTubeVideo {
    "kind": string;
    "id": {
        "kind": string;
        "videoId": string;
    };
    "snippet": {
        "publishedAt": string;
        "channelId": string;
        "title": string;
        "description": string;
        "thumbnails": {
            "default": {
                "url": string;
                "width": number;
                "height": number;
            };
            "medium": {
                "url": string;
                "width": number;
                "height": number;
            };
            "high": {
                "url": string;
                "width": number;
                "height": number;
            };
        };
        "channelTitle": string;
        "liveBroadcastContent": string;
    };
}

module.exports = TwitchStreamingService;