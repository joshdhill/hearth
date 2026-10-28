package com.joshdhill.hearth

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import java.io.File

/**
 * Hearth for Google TV.
 * A native 4K video player sits underneath a transparent web page that paints the scenes,
 * runs the menu and talks to Spotify. The page lives on GitHub Pages, so scenes update
 * without reinstalling the app.
 */
@OptIn(UnstableApi::class)
class MainActivity : Activity() {

    companion object {
        const val START_URL = "https://joshdhill.github.io/hearth/"
        private val SPOTIFY_PACKAGES = listOf("com.spotify.tv.android", "com.spotify.music")
        private var cache: SimpleCache? = null
    }

    private lateinit var web: WebView
    private lateinit var playerView: PlayerView
    private var video: ExoPlayer? = null
    private var sound: ExoPlayer? = null
    private val ui = Handler(Looper.getMainLooper())
    private var videoUrl: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemUi()

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)

        playerView = PlayerView(this).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            setShutterBackgroundColor(Color.BLACK)
            visibility = View.INVISIBLE
        }
        root.addView(playerView, FrameLayout.LayoutParams(-1, -1))

        WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            addJavascriptInterface(Bridge(), "HearthNative")
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = false
                override fun onPageFinished(view: WebView, url: String) {
                    // Spotify's sign-in page isn't built for a remote: add arrow-key focus moving
                    if (!url.startsWith(START_URL)) view.evaluateJavascript(DPAD_HELPER, null)
                }
            }
        }
        root.addView(web, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        web.loadUrl(START_URL)
        web.requestFocus()
    }

    private fun hideSystemUi() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
    }

    // ---- video ---------------------------------------------------------------

    private fun mediaCache(): SimpleCache {
        cache?.let { return it }
        val c = SimpleCache(File(cacheDir, "media"), LeastRecentlyUsedCacheEvictor(2L * 1024 * 1024 * 1024), StandaloneDatabaseProvider(this))
        cache = c
        return c
    }

    private fun sourceFactory(): DefaultMediaSourceFactory {
        val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true).setUserAgent("Hearth/1.0")
        val cached = CacheDataSource.Factory().setCache(mediaCache()).setUpstreamDataSourceFactory(http)
        return DefaultMediaSourceFactory(cached)
    }

    private fun playVideo(url: String) {
        if (url == videoUrl && video != null) return
        videoUrl = url
        val p = video ?: ExoPlayer.Builder(this).setMediaSourceFactory(sourceFactory()).build().also {
            // no audio focus request, so Spotify keeps playing alongside the fire
            it.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), false)
            it.repeatMode = Player.REPEAT_MODE_ONE
            it.addListener(object : Player.Listener {
                override fun onRenderedFirstFrame() { playerView.visibility = View.VISIBLE }
            })
            video = it
            playerView.player = it
        }
        p.setMediaItem(MediaItem.fromUri(url))
        p.prepare()
        p.playWhenReady = true
    }

    private fun stopVideo() {
        videoUrl = null
        playerView.visibility = View.INVISIBLE
        video?.stop()
    }

    private fun playSound(url: String, volume: Float) {
        val p = sound ?: ExoPlayer.Builder(this).setMediaSourceFactory(sourceFactory()).build().also {
            it.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SONIFICATION).build(), false)
            sound = it
        }
        p.volume = volume
        p.setMediaItem(MediaItem.fromUri(url))
        p.prepare()
        p.playWhenReady = true
    }

    // ---- Spotify ---------------------------------------------------------------

    private fun spotifyPackage(): String? = SPOTIFY_PACKAGES.firstOrNull {
        try { packageManager.getPackageInfo(it, 0); true } catch (e: Exception) { false }
    }

    /** Nudge Spotify awake in the background with a media "play" press, the way headphones do. */
    private fun wakeSpotify() {
        val pkg = spotifyPackage() ?: return
        for (action in listOf(KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP)) {
            val t = SystemClock.uptimeMillis()
            val i = Intent(Intent.ACTION_MEDIA_BUTTON).setPackage(pkg)
                .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(t, t, action, KeyEvent.KEYCODE_MEDIA_PLAY, 0))
            sendBroadcast(i)
        }
    }

    /** Open Spotify for a few seconds so it signs in to Spotify Connect, then come back. */
    private fun openSpotify() {
        val pkg = spotifyPackage() ?: return
        val launch = packageManager.getLeanbackLaunchIntentForPackage(pkg) ?: packageManager.getLaunchIntentForPackage(pkg) ?: return
        startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        ui.postDelayed({
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_NEW_TASK))
        }, 7000)
    }

    inner class Bridge {
        @JavascriptInterface fun playVideo(url: String) { ui.post { this@MainActivity.playVideo(url) } }
        @JavascriptInterface fun stopVideo() { ui.post { this@MainActivity.stopVideo() } }
        @JavascriptInterface fun setVideoVolume(v: Float) { ui.post { video?.volume = v } }
        @JavascriptInterface fun playSound(url: String, v: Float) { ui.post { this@MainActivity.playSound(url, v) } }
        @JavascriptInterface fun wakeSpotify() { ui.post { this@MainActivity.wakeSpotify() } }
        @JavascriptInterface fun openSpotify() { ui.post { this@MainActivity.openSpotify() } }
        @JavascriptInterface fun hasSpotify(): Boolean = spotifyPackage() != null
        @JavascriptInterface fun version(): String = packageManager.getPackageInfo(packageName, 0).versionName ?: "1"
        @JavascriptInterface fun ready() {}
    }

    // ---- remote ----------------------------------------------------------------

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val onHearth = web.url?.startsWith(START_URL) == true
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                if (!onHearth) {
                    if (web.canGoBack()) web.goBack() else web.loadUrl(START_URL)
                } else {
                    web.evaluateJavascript("window.hearth ? window.hearth.back() : false") { r -> if (r == "false") finish() }
                }
            }
            return true
        }
        if (onHearth && event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                    web.evaluateJavascript("window.hearth && window.hearth.key('playpause')", null); return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        web.onResume()
        video?.playWhenReady = videoUrl != null
    }

    override fun onPause() {
        super.onPause()
        web.onPause()
        video?.playWhenReady = false
    }

    override fun onDestroy() {
        video?.release(); sound?.release()
        web.destroy()
        super.onDestroy()
    }
}

/** Arrow keys move between links, fields and buttons on pages that weren't made for a remote. */
private const val DPAD_HELPER = """
(function(){
  if (window.__hearthDpad) return; window.__hearthDpad = true;
  var sel = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[tabindex]:not([tabindex="-1"])';
  function items(){ return Array.prototype.filter.call(document.querySelectorAll(sel), function(e){ var r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && !e.disabled; }); }
  function mark(e){ if(!e) return; e.focus(); e.style.outline='4px solid #c9a86a'; e.style.outlineOffset='2px'; e.scrollIntoView({block:'center'}); }
  document.addEventListener('focusout', function(ev){ if(ev.target && ev.target.style) ev.target.style.outline=''; }, true);
  document.addEventListener('keydown', function(ev){
    var k = ev.key, dirs = {ArrowDown:[0,1],ArrowUp:[0,-1],ArrowRight:[1,0],ArrowLeft:[-1,0]};
    var cur = document.activeElement;
    var typing = cur && (cur.tagName==='INPUT' || cur.tagName==='TEXTAREA');
    if (k==='Enter' && cur && !typing) { cur.click(); ev.preventDefault(); return; }
    var d = dirs[k]; if(!d) return;
    if (typing && (k==='ArrowLeft' || k==='ArrowRight')) return;
    var all = items(); if(!all.length) return;
    if (!cur || cur===document.body) { mark(all[0]); ev.preventDefault(); return; }
    var r = cur.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2, best=null, bd=1e9;
    all.forEach(function(e){ if(e===cur) return; var q=e.getBoundingClientRect(), x=q.left+q.width/2-cx, y=q.top+q.height/2-cy;
      if (x*d[0]+y*d[1] <= 2) return; var dist = Math.abs(x*d[0]+y*d[1]) + 2*Math.abs(x*d[1]+y*d[0]); if (dist<bd){bd=dist;best=e;} });
    if (best) { mark(best); ev.preventDefault(); }
  }, true);
})();
"""
