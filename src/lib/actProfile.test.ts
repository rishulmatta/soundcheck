import { describe, expect, it } from "vitest";
import { firstSentence, linksFromQlooExternal, linksFromWikidataClaims, mergeProfile, pickWikiPage } from "./actProfile";

const claim = (v: string) => [{ mainsnak: { datavalue: { value: v } } }];

describe("actProfile", () => {
  it("picks the Wikipedia page whose description fits the act type, skipping disambiguation pages", () => {
    const pages = [
      { key: "Khruangbin_(disambiguation)", description: "Wikipedia disambiguation page" },
      { key: "Khruangbin_(album)", description: "2015 album" },
      { key: "Khruangbin", description: "American musical trio" },
    ];
    expect(pickWikiPage(pages, "artist")?.key).toBe("Khruangbin");
    expect(pickWikiPage(pages, "book")?.key).toBe("Khruangbin_(album)");
    expect(pickWikiPage([], "artist")).toBeUndefined();
  });

  it("keeps the first sentence of an extract and trims long ones", () => {
    expect(firstSentence("Nate Bargatze is an American comedian. He was born in Tennessee.")).toBe("Nate Bargatze is an American comedian.");
    expect(firstSentence("x".repeat(300))?.length).toBe(180);
    expect(firstSentence(undefined)).toBeUndefined();
  });

  it("builds links from Wikidata claims in display order", () => {
    const links = linksFromWikidataClaims({ P2003: claim("khruangbin"), P856: claim("https://khruangbin.com"), P1902: claim("2mVVjNmdjXZZDvhgQWiakk") });
    expect(links.map((l) => l.label)).toEqual(["Official site", "Spotify", "Instagram"]);
    expect(links[1].url).toBe("https://open.spotify.com/artist/2mVVjNmdjXZZDvhgQWiakk");
    expect(linksFromWikidataClaims(undefined)).toEqual([]);
  });

  it("maps Qloo external ids and website to links", () => {
    const links = linksFromQlooExternal({ spotify: [{ id: "abc" }], twitter: [{ id: "khruangbin" }], unknown: [{ id: "x" }] }, "https://khruangbin.com");
    expect(links.map((l) => l.label)).toEqual(["Official site", "Spotify", "X"]);
    expect(linksFromQlooExternal(null)).toEqual([]);
  });

  it("merges so Qloo values win and Wikipedia fills the gaps without duplicate labels", () => {
    const merged = mergeProfile(
      { imageUrl: "https://q/img.jpg", links: [{ label: "Spotify", url: "https://open.spotify.com/artist/q" }] },
      { imageUrl: "https://w/img.jpg", description: "A band.", links: [{ label: "Wikipedia", url: "https://en.wikipedia.org/wiki/X" }, { label: "Spotify", url: "https://open.spotify.com/artist/w" }], source: "wikipedia" },
    );
    expect(merged.imageUrl).toBe("https://q/img.jpg");
    expect(merged.description).toBe("A band.");
    expect(merged.links.map((l) => l.url)).toEqual(["https://open.spotify.com/artist/q", "https://en.wikipedia.org/wiki/X"]);
  });
});
