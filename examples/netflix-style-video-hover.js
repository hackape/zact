const { self, send, receive, spawn, Process, exit } = require('zact')

const log = console.log.bind(console)

function netflixStyleVideoHoverMachine(ctx = { hasVideoLoaded: false }) {
  const _self = self()

  // guards
  function hasLoadedVideo(ctx) {
    return ctx.hasVideoLoaded
  }

  // actions
  function reportVideoLoaded(ctx) {
    return {
      ...ctx,
      hasVideoLoaded: true,
    }
  }

  // fsm states
  function awaitingBackgroundImageLoad(ctx) {
    log('=== awaitingBackgroundImageLoad ===')
    return receive({
      REPORT_IMAGE_LOADED: () => idle(ctx),
      REPORT_IMAGE_FAILED_TO_LOAD: () => imageFailedToLoad(ctx),
    })
  }

  function imageFailedToLoad(ctx) {
    log('=== imageFailedToLoad ===')
    throw Error('imageFailedToLoad')
  }

  function idle(ctx) {
    log('=== idle ===')
    return receive({
      MOUSE_OVER: () => {
        return showingVideo(ctx)
      },
    })
  }

  function showingVideo(ctx) {
    log('=== showingVideo ===')

    function autoPlayingVideo(ctx) {
      log('=== showingVideo.autoPlayingVideo ===')
      console.log('ctx::', ctx)
    }

    function loadingVideoSrc(ctx) {
      log('=== showingVideo.loadingVideoSrc ===')

      function cannotMoveOn(ctx) {
        log('=== cannotMoveOn ==')

        const receiver = msg => {
          if (msg.type === 'after') {
            return canMoveOn(ctx)
          }

          if (msg.type === 'REPORT_VIDEO_LOADED') {
            ctx = reportVideoLoaded(ctx)
          }

          return receiver
        }

        setTimeout(() => {
          send(_self, { type: 'after' })
        }, 2000)

        return receiver
      }

      function canMoveOn(ctx) {
        log('=== canMoveOn ==')
        if (hasLoadedVideo(ctx)) {
          return loaded(ctx)
        }

        return msg => {
          if (msg.type === 'REPORT_VIDEO_LOADED') {
            ctx = reportVideoLoaded(ctx)
            return loaded(ctx)
          }
        }
      }

      function loaded(ctx) {
        log('=== loaded ==')
        return exit(ctx)
      }

      return cannotMoveOn(ctx)
    }

    function waitingBeforePlaying(ctx) {
      log('=== showingVideo.waitingBeforePlaying ===')

      setTimeout(() => {
        send(_self, { type: 'after' })
      }, 2000)

      return msg => {
        if (msg.type === 'after') {
          return autoPlayingVideo(ctx)
        }
      }
    }

    function checkingIfVideoHasLoaded(ctx) {
      log('=== showingVideo.checkingIfVideoHasLoaded ===')
      if (hasLoadedVideo(ctx)) {
        return waitingBeforePlaying(ctx)
      } else {
        return loadingVideoSrc(ctx)
      }
    }

    const pid = spawn(checkingIfVideoHasLoaded, [ctx])
    Process.monitor(pid)
    return msg => {
      if (msg.type === 'MOUSE_OUT') {
        Process.exit(pid, ':kill')
        return idle(ctx)
      } else if (msg.type === ':DOWN') {
        // child exit
        console.log('child exit', msg.data)
        return autoPlayingVideo()
      } else {
        // forward to sub machine
        send(pid, msg)
      }
    }
  }

  return awaitingBackgroundImageLoad(ctx)
}

module.exports = function main() {
  const pid = spawn(netflixStyleVideoHoverMachine)
  pid.send({ type: 'REPORT_IMAGE_LOADED' })
  pid.send({ type: 'MOUSE_OVER' })
  // pid.send({ type: 'MOUSE_OUT' })

  return pid
}

// main()
globalThis.Process = Process
