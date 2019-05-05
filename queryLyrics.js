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
      .then(xml => this.parseLyricsXmlResponse(xml))
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

  parseLyricsXmlResponse(xml) {
    let parser = new DOMParser();
    let xmlDoc = parser.parseFromString(xml, "text/xml");
    try {
      let lyricsElem = xmlDoc.getElementsByTagName("Lyric")[0].childNodes[0]
      if (!lyricsElem)
        return new LyricsNotFoundResult("lyrics empty")

      let lyrics = lyricsElem.nodeValue
      if (isNullOrEmpty(lyrics))
        return new LyricsNotFoundResult("lyrics empty")

      let lyricsSourceLink = '';
      try { lyricsSourceLink = this.getXmlValue(xmlDoc, 'LyricUrl') }
      catch (err) { console.log('error parsing LyricUrl') }

      let coverArtUrl = ''
      try { coverArtUrl = xmlDoc.getElementsByTagName("LyricCovertArtUrl")[0].childNodes[0].nodeValue }
      catch (err) { console.log('error getting cover art url', err) }

      return new LyricsFoundResult({ lyrics: lyrics, coverArtUrl: coverArtUrl, lyricsSourceLink: lyricsSourceLink })
    }
    catch (err) {
      console.log(err)
      return new LyricsNotFoundResult(err.message)
    }
  }

  getXmlValue(xmlDoc, tagName) {
    return xmlDoc.getElementsByTagName(tagName)[0].childNodes[0].nodeValue
  }

  extractResponseStatusDetails(response) {
    return { url: response.url, status: response.status, statusText: response.statusText }
  }

}

function isNullOrEmpty(str) {
  return str == null || str === ''
}