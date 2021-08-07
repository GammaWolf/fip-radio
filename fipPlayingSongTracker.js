function Playing(artist, song) {
    this.artist = artist;
    this.song = song;
    this.isValid = artist != null && artist != '' && song != null && song != '';
    this.lyricsResult = null;
    this.serverTime = null;
    this.nextRefresh = null;
  }

// notifies subscribers of changes to the currently playing song
// users of this class must set activeChannelId
class FipPlayingSongTracker {
    autoUpdateIntervalInMs = 6000
    playing = null
    updateTimeoutId = null
    observers = []
    _activeChannelId = null

    constructor(activeChannelId) {
        this._activeChannelId = activeChannelId
    }

    set activeChannelId(activeChannelId) {
        this._activeChannelId = activeChannelId
        this.setPlaying(null)
        this.update()
      }

      get activeChannelId() {
        return this._activeChannelId;
      }

    subscribePlayingChanged(observer) {
        this.observers.push(observer)
    }
    
    async update() {
        try {
            let localChannelIdAtStart = this.activeChannelId

            console.log("playingTracker::update() " + this.activeChannelId)

            // clear any timeout that might still be active
            clearTimeout(this.updateTimeoutId)
            this.updateTimeoutId = null

            if (!this.activeChannelId) {
                Promise.reject("activeChannelId is not set")
                return
            }

            // fetch song
            let freshPlaying = await this.fetchPlaying()

            // Reentrancy check, abort if update was called while previous update call (a)waited.
            // Checking local against member var: if another update was called, while we were waiting, it would have changed the member var
            if (localChannelIdAtStart !== this.activeChannelId) {
                console.log("reentrancy detected, aborting")
                this.playing = null
                return
            }

            if (!freshPlaying) {
                this.setPlaying(null)
                return
            }

            if (!freshPlaying.isValid) {
                console.log('currentlyPlaying is not valid')
                return
            }

            let nowInSecs = Math.round(Date.now() / 1000)
            // console.log('times: ' + JSON.stringify({ nowInSecs: nowInSecs, serverTime: freshPlaying.serverTime, nextRefresh: freshPlaying.nextRefresh }))

            // schedule next update
            if (freshPlaying.serverTime && freshPlaying.nextRefresh) {
                let numSecondsToNextRefresh = Math.max(freshPlaying.nextRefresh - nowInSecs, 3)
                if (Number.isInteger(numSecondsToNextRefresh) && numSecondsToNextRefresh > 0) {
                    this.updateTimeoutId = setTimeout(() => this.update(), numSecondsToNextRefresh * 1000)
                    console.log('next update scheduled in ' + numSecondsToNextRefresh + ' seconds')
                } else {
                    console.warn('numSecondsToNextRefresh has bad value: ' + numSecondsToNextRefresh)
                }
            }

            let hasSongChanged =
                !this.playing
                || this.playing.artist !== freshPlaying.artist
                || this.playing.song !== freshPlaying.song

            console.log('hasSongChanged ' + hasSongChanged)
            if (hasSongChanged) {
                this.setPlaying(freshPlaying)
            }
        } finally {
            if (this.updateTimeoutId === null) {
                this.updateTimeoutId = setTimeout(() => this.update(), this.autoUpdateIntervalInMs)
                console.log('next update scheduled in finally in ' + this.autoUpdateIntervalInMs / 1000 + ' seconds')
            }
        }
    }

    setPlaying(playing) {
        if (this.playing === playing)
            return

        this.playing = playing
        this.observers.forEach(o => o(playing))
    }

    async fetchPlaying() {
        console.log('fetching currently playing')
        let url = "latest/api/graphql?operationName=Now&variables=%7B%22stationId%22:" + this.activeChannelId + ",%22previousTrackLimit%22:1%7D&extensions=%7B%22persistedQuery%22:%7B%22version%22:1,%22sha256Hash%22:%228a931c7d177ff69709a79f4c213bd2403f0c11836c560bc22da55628d8100df8%22%7D%7D"

        // Add new random guid for each rq to prevent getting stale/cached results.
        // Had cases where it responded with over 10 minutes old data, where Date.now() has way passed next_refresh.
        // Retrying directly after the stale response also often failed to get fresher data.
        // This issue seems to be on fip server side, could replicate with curl.
        url += '&x=' + this.uuidv4()

        if (isDevMode) {
            url = "https://www.fip.fr/" + url
        }

        let response = await fetch(url, {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache'
            }
        })

        let json = null
        try {
            json = await response.json()
        }
        catch (err) {
            console.log('err converting response to json', err)
        }
        if (json) {
            // don't use data if stale
            if (this.isFipResponseStale(json)) {
                console.log('detected stale response')
                return null
            }
            return this.playingFromJson(json)
        }
        else {
            return null
        }
    }

    isFipResponseStale(json) {
        if (json.data.now?.next_refresh) {
            let nowInSeconds = Math.round(Date.now() / 1000)
            let isStale = nowInSeconds >= json.data.now.next_refresh
            if (isStale) {
                console.log('IsFipResponseStale: true, next_refresh ' + json.data.now.next_refresh + ', now ' + nowInSeconds)
            }
            return isStale
        } else {
            console.log('could not determine next_refresh, returning stale')
            return true
        }
    }

    playingFromJson(json) {
        try {
            let songInfo = json.data.now.song
            if (songInfo == null) {
                console.log('songInfo null')
            }

            let serverTime = json.data.now.server_time
            let nextRefresh = json.data.now.next_refresh

            let interpreters = null
            let songTitle = null

            if (songInfo != null) {
                interpreters = songInfo.interpreters ? songInfo.interpreters.join(', ') : null
                songTitle = songInfo.title
            } else {
                console.log("response's songInfo is null")
                // sometimes json.data.now.song is null. but the next song in the json is already playing -> use that
                let nextTracks = json.data.nextTracks
                if (nextTracks && nextTracks.length > 0) {
                    let nextTrackStartTime = nextTracks[0].start_time
                    // has next track started playing already
                    if (serverTime >= nextTrackStartTime) {
                        // only if song could reasonably still be playing
                        const MAX_SONG_LENGTH_SEC = 60 * 10
                        if (nextTrackStartTime && serverTime > nextTrackStartTime + MAX_SONG_LENGTH_SEC) {
                            console.log("not using response's nextTracks because it's stale")
                            return null
                        }
                        console.log('using data from json nextTitles')
                        interpreters = nextTracks[0].title
                        songTitle = nextTracks[0].subtitle
                    }
                } else {
                    console.log("nextTracks empty")
                }
            }

            let p = new Playing(
                interpreters,
                songTitle)

            p.serverTime = serverTime
            p.nextRefresh = nextRefresh
            return p
        }
        catch (err) {
            console.log('err getting currently playing', err)
        }
        return null; // not found
    }

    // https://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid
    uuidv4() {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

}
