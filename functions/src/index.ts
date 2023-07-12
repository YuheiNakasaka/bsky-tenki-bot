import { AppBskyFeedPost, AppBskyRichtextFacet, BskyAgent } from "@atproto/api";
import * as functions from "firebase-functions";
import { defineString } from "firebase-functions/params";
import parse from "node-html-parser";

const bskyService = "https://bsky.social";
const tenkiURL = "https://tenki.jp/amedas/3/16/44132.html";

export const postJob = functions.pubsub
  .schedule("05 */1 * * *")
  .onRun(async (_) => {
    // Blueskyへログイン
    const agent = new BskyAgent({ service: bskyService });
    await agent.login({
      identifier: defineString("BSKY_ID").value(),
      password: defineString("BSKY_PASSWORD").value(),
    });

    // 天気情報を取得
    const resp = await fetch(tenkiURL);
    const html = parse(await resp.text());
    const temp = html
      .querySelectorAll(".amedas-current-list li")[0]
      .innerText?.replace(/&nbsp;/, "");
    const title = html.querySelector("title")?.innerText;
    const ogpText = html
      .querySelector("meta[name='description']")
      ?.getAttribute("content");
    const ogpImg = html
      .querySelector("meta[property='og:image']")
      ?.getAttribute("content");

    // リッチテキストの作成
    // Lexicon: https://atproto.com/lexicons/app-bsky-richtext#appbskyrichtextfacet
    // 投稿例) 東京の気温:29.5℃ https://tenki.jp/amedas/3/16/44132.html
    const encoder = new TextEncoder();
    const plainText = `[botのテスト中] 東京の気温: ${temp} `.slice(0, 299);
    const byteStart = encoder.encode(plainText).byteLength;
    const byteEnd = byteStart + encoder.encode(tenkiURL).byteLength;
    const textParams = `${plainText}${tenkiURL}`;
    const facetsParams: AppBskyRichtextFacet.Main[] = [
      {
        index: {
          byteStart,
          byteEnd,
        },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: tenkiURL }],
      },
    ];

    // 投稿に埋め込むOGP画像の作成
    // Lexicon: https://atproto.com/lexicons/app-bsky-embed#appbskyembedexternal
    const blob = await fetch(`${ogpImg}`);
    const buffer = await blob.arrayBuffer();
    const response = await agent.uploadBlob(new Uint8Array(buffer), {
      encoding: "image/jpeg",
    });
    const embedParams: AppBskyFeedPost.Record["embed"] = {
      $type: "app.bsky.embed.external",
      external: {
        uri: tenkiURL,
        thumb: {
          $type: "blob",
          ref: {
            $link: response.data.blob.ref.toString(),
          },
          mimeType: response.data.blob.mimeType,
          size: response.data.blob.size,
        },
        title: title,
        description: ogpText,
      },
    };

    // Blueskyへ投稿
    // Lexicon: https://atproto.com/lexicons/app-bsky-feed#appbskyfeedpost
    const postParams: AppBskyFeedPost.Record = {
      $type: "app.bsky.feed.post",
      text: textParams,
      facets: facetsParams,
      embed: embedParams,
      createdAt: new Date().toISOString(),
    };
    await agent.post(postParams);

    return null;
  });
