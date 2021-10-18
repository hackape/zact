const { send, receive, spawn } = require('zact')

function multiStepTimerMachine() {
  function idle() {
    console.log('idle...')
    return receive({
      BEGIN: () => firstStep(),
    })
  }

  function firstStep() {
    console.log('1st...')
    return receive({}).after(3000, secondStep)
  }

  function secondStep() {
    console.log('2nd...')
    return receive({}).after(3000, thirdStep)
  }

  function thirdStep() {
    console.log('3rd...')
    return receive({}).after(3000, idle)
  }

  return idle()
}

const pid = spawn(multiStepTimerMachine)

function main() {
  setTimeout(() => {
    send(pid, { type: 'BEGIN' })
    send(pid, { type: 'GIBBERISH' })
    send(pid, { type: 'BEGIN' })
  }, 500)
}

main()
