import { Mutex } from "async-mutex";

export class Deque<T> {
    private buffer: (T | undefined)[];
    private capacity: number;
    public size: number = 0;

    // fill this index next
    private front: number = 0; // at
    private back: number = 0; // one to the right

    constructor(initialCapacity: number = 32) {
        this.capacity = initialCapacity;
        this.buffer = new Array(this.capacity);
    }

    public push_front(value: T): void {
        if (this.size === this.capacity) {
            this.resize();
        }
        this.front = (this.front + this.capacity - 1) % this.capacity;
        this.buffer[this.front] = value;
        this.size += 1;
    }

    public push_back(value: T): void {
        if (this.size === this.capacity) {
            this.resize();
        }
        this.buffer[this.back] = value;
        this.back = (this.back + 1) % this.capacity;
        this.size += 1;
    }

    public pop_front(): T | undefined {
        if (this.size === 0) {
            return undefined;
        }
        const value = this.buffer[this.front];
        this.buffer[this.front] = undefined; // Allow GC
        this.front = (this.front + 1) % this.capacity;
        this.size -= 1;
        return value;
    }

    public pop_back(): T | undefined {
        if (this.size === 0) {
            return undefined;
        }
        this.back = (this.back + this.capacity - 1) % this.capacity;
        const value = this.buffer[this.back];
        this.buffer[this.back] = undefined; // Allow GC
        this.size -= 1;
        return value;
    }

    public peek_front(): T | undefined {
        if (this.size === 0) {
            return undefined;
        }
        return this.buffer[this.front];
    }

    public peek_back(): T | undefined {
        if (this.size === 0) {
            return undefined;
        }
        const back = (this.back + this.capacity - 1) % this.capacity;
        return this.buffer[back];
    }

    public is_empty(): boolean {
        return this.size === 0;
    }

    private resize(): void {
        const newCapacity = this.capacity * 2;
        const newBuffer = new Array<T | undefined>(newCapacity);

        for (let i = 0; i < this.size; i++) {
            newBuffer[i] = this.buffer[(this.front + i) % this.capacity];
        }

        this.buffer = newBuffer;
        this.capacity = newCapacity;
        this.front = 0;
        this.back = this.size;
    }
}


type Waiter = () => void;

export class Channel<T> {
    private deque: Deque<T>;
    private lock: Mutex = new Mutex();
    private waiters: Waiter[] = [];
    private closed: boolean = false;

    constructor() {
        this.deque = new Deque<T>();
    }

    public async send(val: T): Promise<void> {
        let waiterToNotify: Waiter | undefined;

        const release = await this.lock.acquire();
        try {
            if (this.closed) {
                throw new Error("Cannot send to a closed channel.");
            }

            this.deque.push_back(val);

            if (this.waiters.length > 0) {
                waiterToNotify = this.waiters.shift()!;
            }
        } finally {
            release();
        }

        if (waiterToNotify) {
            // Fulfill the promise outside of the lock
            waiterToNotify();
        }
    }

    public async count(): Promise<number> {
        const release = await this.lock.acquire();
        try {
            return this.deque.size;
        } finally {
            release();
        }
    }

    public async try_recv(): Promise<T | undefined> {
        const release = await this.lock.acquire();
        try {
            return this.deque.pop_front();
        } finally {
            release();
        }
    }

    public async can_recv(): Promise<boolean> {
        const release = await this.lock.acquire();
        try {
            return this.deque.peek_front() !== undefined;
        } finally {
            release();
        }
    }

    public async try_pop(): Promise<T | undefined> {
        const release = await this.lock.acquire();
        try {
            return this.deque.pop_back();
        } finally {
            release();
        }
    }

    // only marks the channel closed for .wait_* operations. does not actually prevent recving or sending to the channel
    // this causes the .wait_* methods to not block. they essentially behave like .try_* methods
    public async close(): Promise<void> {
        let waitersToNotify: Waiter[];
        const release = await this.lock.acquire();
        try {
            if (this.closed) {
                return;
            }
            this.closed = true;
            waitersToNotify = this.waiters;
            this.waiters = [];
        } finally {
            release();
        }

        for (const waiter of waitersToNotify) {
            waiter();
        }
    }

    public async wait_recv(): Promise<T | undefined> {
        while (true) {
            const release = await this.lock.acquire();
            let waitPromise: Promise<void> | null = null;

            try {
                const value = this.deque.pop_front();
                if (value !== undefined) {
                    return value;
                }

                if (this.closed) {
                    return undefined;
                }

                // Queue is empty and channel is open, so we must wait.
                waitPromise = new Promise<void>((resolve) => {
                    this.waiters.push(resolve);
                });
            } finally {
                release();
            }

            // Await the promise outside of the critical section
            await waitPromise;
            // After await, the loop will re-acquire the lock and check again.
        }
    }

    public async wait_pop(): Promise<T | undefined> {
        while (true) {
            const release = await this.lock.acquire();
            let waitPromise: Promise<void> | null = null;

            try {
                const value = this.deque.pop_back();
                if (value !== undefined) {
                    return value;
                }

                if (this.closed) {
                    return undefined;
                }

                // Queue is empty and channel is open, so we must wait.
                waitPromise = new Promise<void>((resolve) => {
                    this.waiters.push(resolve);
                });
            } finally {
                release();
            }

            // Await the promise outside of the critical section
            await waitPromise;
            // After await, the loop will re-acquire the lock and check again.
        }
    }
}



function datastructuee_tests() {

    function assert(condition: boolean, message: string): void {
        if (!condition) {
            throw new Error(`Assertion failed: ${message}`);
        }
    }

    async function testDeque() {
        console.log("Running Deque tests...");

        // Test initialization
        let dq = new Deque<number>();
        assert(dq.size === 0, "Initial size should be 0");
        assert(dq.is_empty(), "Initial deque should be empty");

        // Test push_back and pop_front (FIFO)
        dq.push_back(1);
        dq.push_back(2);
        assert(dq.size === 2, "Size should be 2 after two push_backs");
        assert(dq.pop_front() === 1, "pop_front should return the first element");
        assert(dq.pop_front() === 2, "pop_front should return the second element");
        assert(dq.size === 0, "Size should be 0 after popping all elements");
        assert(dq.pop_front() === undefined, "pop_front on empty deque should be undefined");

        // Test push_front and pop_back (LIFO)
        dq.push_front(1);
        dq.push_front(2);
        assert(dq.size === 2, "Size should be 2 after two push_fronts");
        assert(dq.pop_back() === 1, "pop_back should return the first pushed element");
        assert(dq.pop_back() === 2, "pop_back should return the second pushed element");
        assert(dq.size === 0, "Size should be 0 after popping all elements");
        assert(dq.pop_back() === undefined, "pop_back on empty deque should be undefined");

        // Test mixed operations
        dq.push_back(10); // [10]
        dq.push_front(20); // [20, 10]
        dq.push_back(30); // [20, 10, 30]
        dq.push_front(40); // [40, 20, 10, 30]
        assert(dq.size === 4, "Size should be 4 after mixed pushes");
        assert(dq.pop_front() === 40, "Mixed op pop_front 1");
        assert(dq.pop_back() === 30, "Mixed op pop_back 1");
        assert(dq.pop_front() === 20, "Mixed op pop_front 2");
        assert(dq.pop_back() === 10, "Mixed op pop_back 2");
        assert(dq.is_empty(), "Deque should be empty after mixed pops");

        // Test resizing
        dq = new Deque<number>(4);
        for (let i = 0; i < 10; i++) {
            dq.push_back(i);
        }
        assert(dq.size === 10, "Size should be 10 after resize");
        for (let i = 0; i < 10; i++) {
            assert(dq.pop_front() === i, `Element ${i} should be correct after resize`);
        }
        assert(dq.is_empty(), "Deque should be empty after resize test");

        // Test peek
        dq.push_back(100);
        dq.push_back(200);
        dq.push_front(50);
        assert(dq.peek_front() === 50, "peek_front should show the front element");
        assert(dq.peek_back() === 200, "peek_back should show the back element");
        assert(dq.size === 3, "Peek operations should not change size");

        console.log("Deque tests passed.");
    }

    async function testChannel() {
        console.log("Running Channel tests...");

        // Test send and wait_recv
        let ch = new Channel<number>();
        await ch.send(42);
        assert(await ch.count() === 1, "Count should be 1 after send");
        let val = await ch.wait_recv();
        assert(val === 42, "Received value should be correct");
        assert(await ch.count() === 0, "Count should be 0 after recv");

        // Test blocking wait_recv
        ch = new Channel<string>();
        const recvPromise = ch.wait_recv();
        let resolved = false;
        recvPromise.then(v => {
            assert(v === "hello", "Blocked recv should get the correct value");
            resolved = true;
        });
        // Give a moment to ensure recvPromise is waiting
        await new Promise(res => setTimeout(res, 10));
        assert(!resolved, "Promise should not resolve before send");
        await ch.send("hello");
        await recvPromise; // Wait for the promise to fully complete
        assert(resolved, "Promise should resolve after send");

        // Test try_recv
        ch = new Channel<number>();
        assert(await ch.try_recv() === undefined, "try_recv on empty channel should be undefined");
        await ch.send(10);
        await ch.send(20);
        assert(await ch.try_recv() === 10, "try_recv should get the first value");
        assert(await ch.try_recv() === 20, "try_recv should get the second value");
        assert(await ch.try_recv() === undefined, "try_recv should be undefined after draining");

        // Test close
        ch = new Channel<number>();
        const waitingRecv = ch.wait_recv();
        let closedRecvResolved = false;
        waitingRecv.then(v => {
            assert(v === undefined, "Waiting recv should resolve to undefined when closed");
            closedRecvResolved = true;
        });
        await new Promise(res => setTimeout(res, 10));
        await ch.close();
        await waitingRecv;
        assert(closedRecvResolved, "Waiting promise on close should be resolved");
        assert(await ch.wait_recv() === undefined, "wait_recv on closed empty channel should be undefined");

        // Test draining a channel after close
        ch = new Channel<number>();
        await ch.send(1);
        await ch.send(2);
        await ch.close();
        assert(await ch.wait_recv() === 1, "Should be able to drain first item after close");
        assert(await ch.wait_recv() === 2, "Should be able to drain second item after close");
        assert(await ch.wait_recv() === undefined, "Should be undefined after draining a closed channel");
        try {
            await ch.send(3);
            assert(false, "Should not be able to send to a closed channel");
        } catch (e: any) {
            assert(e.message === "Cannot send to a closed channel.", "Sending to closed channel should throw specific error");
        }

        // Test multiple waiters
        ch = new Channel<number>();
        const p1 = ch.wait_recv();
        const p2 = ch.wait_recv();
        await ch.send(101);
        await ch.send(102);
        const results = await Promise.all([p1, p2]);
        assert(results[0] === 101 && results[1] === 102, "Multiple waiters should receive values in order");

        // Test wait_pop (LIFO)
        ch = new Channel<number>();
        await ch.send(1);
        await ch.send(2);
        await ch.send(3);
        assert(await ch.wait_pop() === 3, "wait_pop should get last element first");
        assert(await ch.wait_pop() === 2, "wait_pop should get middle element second");
        assert(await ch.wait_pop() === 1, "wait_pop should get first element last");

        // Test try_pop
        ch = new Channel<number>();
        await ch.send(1);
        await ch.send(2);
        assert(await ch.try_pop() === 2, "try_pop should get last element");
        assert(await ch.try_pop() === 1, "try_pop should get first element");
        assert(await ch.try_pop() === undefined, "try_pop on empty channel should be undefined");

        console.log("Channel tests passed.");
    }


    async function runTests() {
        try {
            await testDeque();
            await testChannel();
            console.log("\nAll tests passed successfully!");
        } catch (error) {
            console.error("\nTests failed!");
            console.error(error);
            process.exit(1);
        }
    }

    runTests();

    // A helper to introduce a small delay, allowing other async tasks to run.
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));

    async function testCloseWithWaitingReceivers() {
        console.log("Running test: Close with waiting receivers...");
        const ch = new Channel<number>();
        const numWaiters = 5;
        const promises: Promise<number | undefined>[] = [];

        for (let i = 0; i < numWaiters; i++) {
            promises.push(ch.wait_recv());
        }

        // Give promises a moment to enter the waiting state
        await tick();

        await ch.close();

        const results = await Promise.all(promises);
        results.forEach((res, i) => {
            assert(res === undefined, `Waiting receiver ${i} should resolve with undefined on close`);
        });

        // A final check to ensure it still returns undefined
        const finalRecv = await ch.wait_recv();
        assert(finalRecv === undefined, "wait_recv on an empty, closed channel should return undefined");
        console.log("...PASSED");
    }

    async function testCloseWithItemsInQueue() {
        console.log("Running test: Close with items in queue...");
        const ch = new Channel<number>();
        const items = [10, 20, 30];
        for (const item of items) {
            await ch.send(item);
        }

        await ch.close();

        assert(await ch.count() === 3, "Count should be 3 before draining");

        for (const item of items) {
            const val = await ch.wait_recv();
            assert(val === item, `Should drain item ${item} after close`);
        }

        assert(await ch.count() === 0, "Count should be 0 after draining");

        const finalVal = await ch.wait_recv();
        assert(finalVal === undefined, "Should return undefined after draining a closed channel");
        console.log("...PASSED");
    }

    async function testSendToClosedChannel() {
        console.log("Running test: Send to a closed channel...");
        const ch = new Channel<number>();
        await ch.send(1); // send one item
        await ch.close();

        try {
            await ch.send(2);
            assert(false, "Sending to a closed channel should have thrown an error");
        } catch (e: any) {
            assert(e.message === "Cannot send to a closed channel.", "Error message for sending to closed channel is incorrect");
        }

        // Ensure the original item is still there
        const val = await ch.try_recv();
        assert(val === 1, "Item sent before close should still be receivable");
        console.log("...PASSED");
    }

    async function testMultipleProducersSingleConsumer() {
        console.log("Running test: Multiple Producers, Single Consumer (MPSC)...");
        const ch = new Channel<number>();
        const numProducers = 10;
        const messagesPerProducer = 100;
        const totalMessages = numProducers * messagesPerProducer;
        let receivedCount = 0;

        const producerPromises = [];
        for (let i = 0; i < numProducers; i++) {
            const promise = (async () => {
                for (let j = 0; j < messagesPerProducer; j++) {
                    await ch.send(i * messagesPerProducer + j);
                }
            })();
            producerPromises.push(promise);
        }

        const consumerPromise = (async () => {
            while (receivedCount < totalMessages) {
                const val = await ch.wait_recv();
                if (val !== undefined) {
                    receivedCount++;
                } else {
                    // Should not happen in this test
                    assert(false, "Consumer received undefined before all messages were sent");
                    break;
                }
            }
        })();

        await Promise.all(producerPromises);
        await consumerPromise;

        assert(receivedCount === totalMessages, `MPSC: Expected ${totalMessages} messages, but received ${receivedCount}`);
        console.log("...PASSED");
    }

    async function testMultipleProducersMultipleConsumers() {
        console.log("Running test: Multiple Producers, Multiple Consumers (MPMC)...");
        const ch = new Channel<number>();
        const numProducers = 5;
        const numConsumers = 5;
        const messagesPerProducer = 50;
        const totalMessages = numProducers * messagesPerProducer;

        const sentMessages = new Set<number>();
        const receivedMessages = new Set<number>();

        // Using an array to avoid race conditions on a simple counter
        const receivedTracker: number[] = [];

        const producerPromises = [];
        for (let i = 0; i < numProducers; i++) {
            const promise = (async () => {
                for (let j = 0; j < messagesPerProducer; j++) {
                    const message = i * messagesPerProducer + j;
                    sentMessages.add(message);
                    await ch.send(message);
                }
            })();
            producerPromises.push(promise);
        }

        const consumerPromises = [];
        for (let i = 0; i < numConsumers; i++) {
            const promise = (async () => {
                while (receivedTracker.length < totalMessages) {
                    const val = await ch.wait_recv();
                    if (val !== undefined) {
                        // This block is not perfectly atomic, but good enough for this test
                        receivedTracker.push(val);
                        receivedMessages.add(val);
                    } else {
                        // This could happen if consumers out-run producers and the channel is closed.
                        // We'll close it later, so this shouldn't happen yet.
                        break;
                    }
                }
            })();
            consumerPromises.push(promise);
        }

        await Promise.all(producerPromises);

        // Wait until all messages are consumed. This is a bit tricky.
        // We'll poll the received count.
        while (receivedTracker.length < totalMessages) {
            await new Promise(res => setTimeout(res, 20));
        }

        await ch.close(); // Close the channel to unblock any waiting consumers
        await Promise.all(consumerPromises); // Wait for consumers to finish

        assert(receivedMessages.size === totalMessages, `MPMC: Expected ${totalMessages} unique messages, but received ${receivedMessages.size}`);

        for (const msg of sentMessages) {
            assert(receivedMessages.has(msg), `MPMC: Message ${msg} was sent but not received`);
        }

        console.log("...PASSED");
    }


    async function testWaitPopAndClose() {
        console.log("Running test: wait_pop and close...");
        const ch = new Channel<number>();
        const p1 = ch.wait_pop();

        await tick(); // ensure p1 is waiting
        await ch.close();

        const val = await p1;
        assert(val === undefined, "wait_pop should resolve to undefined on close");
        console.log("...PASSED");
    }

    async function testInterleavedOperations() {
        console.log("Running test: Interleaved send/recv/close...");
        const ch = new Channel<string>();

        // 1. Send, then receive immediately
        await ch.send("A");
        const valA = await ch.wait_recv();
        assert(valA === "A", "Interleaved 1: Basic send/recv failed");

        // 2. Start a receiver, then send
        const pRecvB = ch.wait_recv();
        await tick();
        await ch.send("B");
        const valB = await pRecvB;
        assert(valB === "B", "Interleaved 2: Blocked recv failed");

        // 3. Start a receiver, close the channel
        const pRecvC = ch.wait_recv();
        await tick();
        await ch.close();
        const valC = await pRecvC;
        assert(valC === undefined, "Interleaved 3: Blocked recv should get undefined on close");

        // 4. Try sending and receiving on closed channel
        try {
            await ch.send("D");
            assert(false, "Interleaved 4: Send on closed channel should fail");
        } catch (e) {
            // Expected
        }
        const valD = await ch.wait_recv();
        assert(valD === undefined, "Interleaved 4: Recv on closed channel should be undefined");

        console.log("...PASSED");
    }

    async function runAllAdvancedTests() {
        console.log("--- Starting Advanced Channel Tests ---");
        try {
            await testCloseWithWaitingReceivers();
            await testCloseWithItemsInQueue();
            await testSendToClosedChannel();
            await testWaitPopAndClose();
            await testInterleavedOperations();
            await testMultipleProducersSingleConsumer();
            await testMultipleProducersMultipleConsumers(); // This one is the most intensive

            console.log("\n--- All advanced tests passed successfully! ---");
        } catch (error) {
            console.error("\n--- Advanced tests FAILED! ---");
            console.error(error);
            process.exit(1);
        }
    }

    runAllAdvancedTests();
}
