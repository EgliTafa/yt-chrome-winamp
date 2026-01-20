// content/youtube_state.js
(() => {
  const CS = (globalThis.__WINAMP_CS__ = globalThis.__WINAMP_CS__ || {});
  const S = CS.state;

  CS.extractVideoIdFromUrl =
    CS.extractVideoIdFromUrl ||
    ((url) => {
      const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
      return match ? match[1] : null;
    });

  CS.detectAndSendState =
    CS.detectAndSendState ||
    (() => {
      const url = window.location.href;
      const urlParams = new URLSearchParams(window.location.search);

      const videoId = urlParams.get("v") || CS.extractVideoIdFromUrl(url);
      const playlistId = urlParams.get("list");

      S.currentVideoId = videoId;
      S.currentPlaylistId = playlistId;

      CS.safePost({
        type: "YOUTUBE_STATE",
        videoId,
        playlistId,
        url: window.location.href,
        hasPlayer: !!document.querySelector("video"),
      });
    });
})();
