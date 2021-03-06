import * as VXViews from './VXOutputModules.js'

let views = [
  VXViews.PopupOutputModule,
  VXViews.SoundOutputModule,
  VXViews.SessionNotificationOutputModule,
  VXViews.TranscriptNotificationOutputModule,
  VXViews.CustomOutputModule,
]

let resultHandler = defaultResultHandler
let currentSettings

const state = mobx.observable({
  status: 'idle',
  interimTranscript: '',
  finalTranscript: '',
})

// View
{
  const actions = {
    stop() {
      if (isActive()) {
        recognition.stop()
      }
    },
  }

  const view = payload => {
    views.forEach(v => {
      try {
        if (currentSettings) {
          v(payload, currentSettings, actions)
        }
      } catch (e) {
        console.error(`Output module "${v.name}" failed`, e)
      }
    })
  }

  const viewState = mobx.observable({
    showing: false,
    get shouldShow() {
      const { status } = state
      return status === 'listening' || status === 'starting'
    },
  })

  let hideTimer
  mobx.reaction(
    () => viewState.shouldShow,
    shouldShow => {
      clearTimeout(hideTimer)
      if (shouldShow) {
        viewState.showing = true
      } else {
        hideTimer = setTimeout(() => {
          viewState.showing = false
        }, 1500)
      }
    },
  )

  mobx.autorun(() => {
    const { status, interimTranscript, finalTranscript } = state
    const { showing } = viewState
    view({ status, finalTranscript, interimTranscript, showing })
  })
}

function log(fmt, ...args) {
  console.log(`[VXController] ${fmt}`, ...args)
}

var recognition = new webkitSpeechRecognition() // azureSpeechRecognition() //

recognition.continuous = true
recognition.interimResults = true

recognition.onstart = function() {
  mobx.runInAction('onstart', () => {
    state.status = 'listening'
  })
  log('Ready to listen')
}

recognition.onerror = function(event) {
  mobx.runInAction('onerror', () => {
    state.status = 'error'
  })
  if (event.error === 'no-speech') {
    log('Closed: No speech')
    return
  }
  const logError = message => {
    log('Error: ' + message)
  }
  if (event.error === 'audio-capture') {
    logError('No microphone was found.')
    chrome.tabs.create({
      url: chrome.runtime.getURL('options.html') + '?err=audio-capture',
    })
  }
  if (event.error === 'not-allowed') {
    logError('Permission to use microphone is blocked.')
    chrome.tabs.create({
      url: chrome.runtime.getURL('options.html') + '?err=not-allowed',
    })
  }
}

recognition.onend = function() {
  mobx.runInAction('onend', () => {
    state.status = 'ended'
  })
  log('Ended')
}

function filterTranscript(text) {
  if (!currentSettings.customTranscriptFilterCode) return text
  const output = new Function(
    'text',
    currentSettings.customTranscriptFilterCode,
  )(text)
  return String(output || text)
}

recognition.onresult = function(event) {
  var finalTranscript = ''
  var interimTranscript = ''
  for (var i = event.resultIndex; i < event.results.length; ++i) {
    if (event.results[i].isFinal) {
      finalTranscript += event.results[i][0].transcript
    } else {
      interimTranscript += event.results[i][0].transcript
    }
  }
  const filteredFinalTranscript = filterTranscript(finalTranscript)
  const filteredInterimTranscript = filterTranscript(interimTranscript)
  mobx.runInAction('onresult', () => {
    state.finalTranscript = filteredFinalTranscript
    state.interimTranscript = filteredInterimTranscript
  })
  resultHandler(filteredInterimTranscript, filteredFinalTranscript)
}

function defaultResultHandler(interimTranscript, finalTranscript) {
  if (finalTranscript) {
    if (currentSettings.outputClipboard === 'on') {
      copyTextToClipboard(finalTranscript.trim())
    }
  }
}

function start(lang) {
  mobx.runInAction('start', () => {
    state.status = 'starting'
    state.interimTranscript = ''
    state.finalTranscript = ''
  })
  log('Start listening for ' + lang)
  recognition.lang = lang
  recognition.start()
}

function copyTextToClipboard(text) {
  var copyFrom = document.createElement('textarea')
  copyFrom.textContent = text
  document.body.appendChild(copyFrom)
  copyFrom.select()
  document.execCommand('copy')
  copyFrom.blur()
  document.body.removeChild(copyFrom)
}

export function isActive() {
  return state.status === 'listening' || state.status === 'starting'
}

export function toggle(request) {
  currentSettings = request.settings
  if (isActive()) {
    recognition.stop()
  } else {
    resultHandler = request.resultHandler || defaultResultHandler
    start(request.lang)
  }
}
