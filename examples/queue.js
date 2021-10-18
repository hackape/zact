const { self, send, receive, spawn } = require('zact')

const wait = interval => new Promise(resolve => setTimeout(resolve, interval))

function queueMachine(state = { queue: [] }) {
  const _self = self()

  // guards
  function thereAreMoreItemsInTheQueue(state) {
    return state.queue.length > 0
  }

  // services
  async function executeOldestItemInQueue(state) {
    const oldestItem = state.queue[0]

    if (!oldestItem) return

    switch (oldestItem.action) {
      case 'ALERT_BROWSER_AFTER_PAUSE': {
        await wait(2000)
        console.warn('Alert from ALERT_BROWSER_AFTER_PAUSE')
        break
      }
      case 'FAIL_AFTER_PAUSE': {
        await wait(2000)
        throw new Error('Something went wrong!')
      }
      default: {
        console.log('other task', oldestItem)
        await wait(100)
      }
    }
  }

  function commonBehavior(state) {
    return { CLEAR_QUEUE: msg => idle(clearQueue(state)) }
  }

  // actions
  function clearQueue(state) {
    return {
      ...state,
      queue: [],
    }
  }

  function addItemToQueue(state, msg) {
    if (msg.type !== 'ADD_TO_QUEUE') return state
    return {
      ...state,
      queue: [
        ...state.queue,
        ...(msg.items?.map(item => ({
          ...item,
          timeAdded: new Date().toISOString(),
        })) || []),
      ],
    }
  }

  function removeOldestItemFromQueue(state) {
    const [_, ...newQueue] = state.queue
    return {
      ...state,
      queue: newQueue,
    }
  }

  // FSM states
  function idle(state) {
    console.log('=== idle ===')
    return receive({
      ...commonBehavior(state),
      ADD_TO_QUEUE: msg => {
        state = addItemToQueue(state, msg)
        return executingItem(state)
      },
    })
  }

  function executingItem(state) {
    console.log('=== executingItem ===')
    // invoke service on entry:
    executeOldestItemInQueue(state).then(
      () => {
        send(_self, { type: 'onDone' })
      },
      err => {
        send(_self, { type: 'onError', reason: err })
      }
    )

    const behavior = receive({
      ...commonBehavior(state),
      ADD_TO_QUEUE: msg => {
        console.log('ADD_TO_QUEUE during executingItem', msg)
        state = addItemToQueue(state, msg)
        return behavior
      },
      onDone: () => {
        const nextState = removeOldestItemFromQueue(state)
        return checkingIfThereAreMoreItems(nextState)
      },
      onError: msg => {
        console.error(msg.reason)
        return awaitingRetry(state)
      },
    })

    return behavior
  }

  function awaitingRetry(state) {
    console.log('=== awaitingRetry ===')
    return receive({
      ...commonBehavior(state),
      ADD_TO_QUEUE: msg => {
        state = addItemToQueue(state, msg)
        return executingItem(state)
      },
      RETRY: () => executingItem(state),
    })
  }

  function checkingIfThereAreMoreItems(state) {
    if (thereAreMoreItemsInTheQueue(state)) {
      return executingItem(state)
    } else {
      return idle(state)
    }
  }

  return executingItem(state)
}

const testQueue = [{ action: 'ALERT_BROWSER_AFTER_PAUSE' }]
async function main() {
  const pid = spawn(queueMachine, [{ queue: testQueue }])

  // send(pid, { type: 'RETRY' })
  // send(pid, { type: 'CLEAR_QUEUE' })
  await wait(500)
  send(pid, { type: 'ADD_TO_QUEUE', items: [{ action: 'foo' }] })
  await wait(500)
  send(pid, { type: 'ADD_TO_QUEUE', items: [{ action: 'bar' }] })
}

main()
