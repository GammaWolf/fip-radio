function LyricsResult(success) {
  this.success = success;
}

function LyricsFoundResult(lyricsInfo) {
  LyricsResult.call(this, true);

  this.lyricsInfo = lyricsInfo;
}

function LyricsNotFoundResult(error) {
  LyricsResult.call(this, false);

  this.error = error;
}

class LyricsService {

  lyricsApiUrl() {
    return 'http://panther.dynu.net/lyrics/cl' // not a field of Lyricsservice class yet, because Firefox doesn't support class fields yet
  }

  queryLyrics(artist, song) {
    return this.makeLyricsRequest(artist, song)
      .then(xml => this.parseLyricsXmlResponse(xml, artist, song))
  }

  makeLyricsRequest(artist, song) {
    // SearchLyricDirect: The artist max length is 75 characters, song max length is 125 characters.
    const artistMaxLen = 75
    const songMaxLen = 125
    let params = 'artist=' + encodeURIComponent(artist.substring(0, artistMaxLen)) + "&song=" + encodeURIComponent(song.substring(0, songMaxLen))
    let url = this.lyricsApiUrl() + '?' + params
    return fetch(url)
      .then(response => {
        if (response.ok) {
          return response.text().catch(err => '')
        }
        else {
          let errorMsg = JSON.stringify(this.extractResponseStatusDetails(response))
          return Promise.reject(new Error(errorMsg))
        }
      })
  }

  parseLyricsXmlResponse(xml, requestedArtist, requestedSong) {
    let parser = new DOMParser();
    let xmlDoc = parser.parseFromString(xml, "text/xml");
    try {
      // extract lyrics
      let lyrics = ''
      try { lyrics = this.getXmlValue(xmlDoc, "Lyric") }
      catch (err) { return new LyricsNotFoundResult("lyrics not found") }

      // ensure artist returned from lyrics search is the same as the requested
      let artist = ''
      try { artist = this.getXmlValue(xmlDoc, 'LyricArtist')}
      catch (err) { console.log('error getting artist')}
      if (artist && !this.isSimilar(artist, requestedArtist)) {
        return new LyricsNotFoundResult('artist expected: ' + requestedArtist + ', but was: ' + artist)
      }
      
      // ensure song returned from lyrics search is the same as the requested
      let song = ''
      try { song = this.getXmlValue(xmlDoc, 'LyricSong') }
      catch (err) { } // ignore
      if (song && !this.isSimilar(song, requestedSong)) {
        return new LyricsNotFoundResult('song expected: ' + requestedSong + ', but was: ' + song)
      }

      // extract misc info
      let lyricsSourceLink = '';
      try { lyricsSourceLink = this.getXmlValue(xmlDoc, 'LyricUrl') }
      catch (err) { console.log('error parsing LyricUrl') }

      let coverArtUrl = ''
      try { coverArtUrl = this.getXmlValue(xmlDoc, 'LyricCovertArtUrl') }
      catch (err) { console.log('error getting cover art url', err) }

      return new LyricsFoundResult({ lyrics: lyrics, coverArtUrl: coverArtUrl, lyricsSourceLink: lyricsSourceLink })
    }
    catch (err) {
      console.log(err)
      return new LyricsNotFoundResult(err.message)
    }
  }

  isSimilar(a,b) {
    if (!a || !b) return false;

    // remove special chars, because those
    // \W Matches any alphanumeric character from the basic Latin alphabet, including the underscore. Equivalent to [A-Za-z0-9_]
    // gi: global, case insensitive
    let rex = /\W/gi
    let la = a.toLocaleLowerCase().replace(rex, '')
    let lb = b.toLocaleLowerCase().replace(rex, '')
    return la.includes(lb) || lb.includes(la)
  }

  getXmlValue(xmlDoc, tagName) {
    return xmlDoc.getElementsByTagName(tagName)[0].childNodes[0].nodeValue
  }

  extractResponseStatusDetails(response) {
    return { url: response.url, status: response.status, statusText: response.statusText }
  }

}
