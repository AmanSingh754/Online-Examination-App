const db = require('./db');

// Normalize functions (same as in exam.routes.js)
const normalizeCodeExecutionOutput = (value) =>
    String(value ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n+$/g, "");

const normalizeOutputForComparison = (value, questionId) => {
    const normalized = normalizeCodeExecutionOutput(value);
    
    if (questionId === 2) {
        return normalized
            .split("\n")
            .map(line => line.replace(/\s+/g, ""))
            .join("\n");
    }
    
    return normalized;
};

async function queryAsync(sql, params) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function main() {
    try {
        console.log("Fetching question 2 testcases...");
        const questions = await queryAsync(
            'SELECT testcases FROM walkin_coding_questions WHERE question_id = 2',
            []
        );

        let testcases = questions[0].testcases;
        if (typeof testcases === 'string') {
            testcases = JSON.parse(testcases);
        }

        console.log("\n=== TESTING SPACE NORMALIZATION FOR QUESTION 2 ===\n");

        // Test case: simulate student output with spaces
        let passedCount = 0;
        
        testcases.forEach((tc, idx) => {
            // Simulate student output (with spaces between numbers)
            const studentOutput = generateStudentOutput(parseInt(tc.input));
            const expectedOutput = tc.expected_output;

            // Apply normalization
            const studentNormalized = normalizeOutputForComparison(studentOutput, 2);
            const expectedNormalized = normalizeOutputForComparison(expectedOutput, 2);

            const passed = studentNormalized === expectedNormalized;

            console.log(`Test ${idx + 1}: Input = ${tc.input}`);
            console.log(`  Student output: ${JSON.stringify(studentOutput)}`);
            console.log(`  Expected output: ${JSON.stringify(expectedOutput)}`);
            console.log(`  After normalization:`);
            console.log(`    Student: ${JSON.stringify(studentNormalized)}`);
            console.log(`    Expected: ${JSON.stringify(expectedNormalized)}`);
            console.log(`  Result: ${passed ? '✓ PASS' : '✗ FAIL'}`);
            console.log();

            if (passed) passedCount++;
        });

        console.log(`\n=== TEST RESULTS ===`);
        console.log(`Total passed: ${passedCount}/${testcases.length}`);
        console.log(`Score: ${(passedCount / testcases.length * 3).toFixed(2)}/3`);
        console.log(`\n✓ Space-normalization test completed successfully!`);

        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

// Simulate the student's code output (with spaces)
function generateStudentOutput(n) {
    const result = [];
    for (let i = 1; i <= n; i++) {
        const spaces = " ".repeat(n - i);
        // Student's code uses " ".join() which adds spaces between numbers
        const inc = Array.from({length: i}, (_, j) => j + 1).join(" ");
        const dec = Array.from({length: i - 1}, (_, j) => i - j - 1).join(" ");
        result.push(spaces + inc + dec);
    }
    return result.join("\n");
}

main();
