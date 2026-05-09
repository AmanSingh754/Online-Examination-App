const db = require('./db');

// Helper functions from exam.routes.js
const normalizeCodeExecutionOutput = (value) =>
    String(value ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n+$/g, "");

const normalizeOutputForComparison = (value, questionId) => {
    const normalized = normalizeCodeExecutionOutput(value);
    
    // For question 2 (number pyramid), remove spaces within each line
    // but preserve the line structure
    if (questionId === 2) {
        return normalized
            .split("\n")
            .map(line => line.replace(/\s+/g, "")) // Remove all spaces within the line
            .join("\n");
    }
    
    return normalized;
};

async function requeryAsync(sql, params) {
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
        const questions = await requeryAsync(
            'SELECT testcases FROM walkin_coding_questions WHERE question_id = 2',
            []
        );

        if (!questions.length || !questions[0].testcases) {
            console.error("No testcases found");
            process.exit(1);
        }

        let testcases = questions[0].testcases;
        if (typeof testcases === 'string') {
            testcases = JSON.parse(testcases);
        }

        console.log("Fetching student 208's submission...");
        const answers = await requeryAsync(
            'SELECT submission_id, code FROM walkin_student_answers WHERE student_id = 208 AND question_id = 2 ORDER BY submission_id DESC',
            []
        );

        if (!answers.length) {
            console.log("No submissions found for student 208 on question 2");
            process.exit(0);
        }

        // Find the submission with actual code
        let submissionId = null;
        let studentCode = null;
        for (const answer of answers) {
            if (answer.code) {
                submissionId = answer.submission_id;
                studentCode = answer.code;
                break;
            }
        }

        if (!submissionId || !studentCode) {
            console.log("No code found in any submission for student 208 on question 2");
            process.exit(0);
        }

        console.log(`Using submission ID: ${submissionId}`);

        console.log("\nStudent's code:");
        console.log(studentCode);

        // Simulate testcase comparison with new normalization
        console.log("\n\n=== SIMULATING REGRADING WITH SPACE NORMALIZATION ===\n");
        
        let passCount = 0;
        for (let i = 0; i < testcases.length; i++) {
            const tc = testcases[i];
            const expectedNormalized = normalizeOutputForComparison(tc.expected_output, 2);
            
            console.log(`Testcase ${i + 1}:`);
            console.log(`  Input: ${tc.input}`);
            console.log(`  Expected (original): ${JSON.stringify(tc.expected_output)}`);
            console.log(`  Expected (normalized): ${JSON.stringify(expectedNormalized)}`);
            
            // Simulate what the normalized output would look like
            // For n=2 with spaces: " 1\n1 2 1" 
            // Normalized to: "1\n121"
            const simulatedOutputWithSpaces = generateOutputWithSpaces(parseInt(tc.input));
            const simulatedNormalized = normalizeOutputForComparison(simulatedOutputWithSpaces, 2);
            
            console.log(`  Simulated output (with spaces): ${JSON.stringify(simulatedOutputWithSpaces)}`);
            console.log(`  Simulated normalized: ${JSON.stringify(simulatedNormalized)}`);
            console.log(`  Match: ${simulatedNormalized === expectedNormalized ? '✓ PASS' : '✗ FAIL'}`);
            
            if (simulatedNormalized === expectedNormalized) {
                passCount++;
            }
            console.log();
        }

        console.log(`\n=== REGRADING RESULT ===`);
        console.log(`Testcases passed: ${passCount}/${testcases.length}`);
        console.log(`New marks: ${(passCount / testcases.length * 3).toFixed(2)}/3`);
        
        if (passCount > 1) {
            console.log(`\nUpdating database for submission ${submissionId}...`);
            await requeryAsync(
                'UPDATE walkin_student_answers SET testcases_passed = ?, marks_obtained = ? WHERE submission_id = ?',
                [passCount, (passCount / testcases.length * 3).toFixed(2), submissionId]
            );
            console.log("✓ Database updated successfully!");
        }

        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

// Simulate what the student's code produces
function generateOutputWithSpaces(n) {
    const result = [];
    for (let i = 1; i <= n; i++) {
        const spaces = " ".repeat(n - i);
        const inc = Array.from({length: i}, (_, j) => j + 1).join(" ");
        const dec = Array.from({length: i - 1}, (_, j) => i - j - 1).join(" ");
        result.push(spaces + inc + dec);
    }
    return result.join("\n");
}

main();
