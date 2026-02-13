import java.util.LinkedHashMap;
import java.util.Map;

public class Solution {
    public static Character firstNonRepeatingChar(String s) {
        Map<Character, Integer> freq = new LinkedHashMap<>();
        for (char ch : s.toCharArray()) {
            freq.put(ch, freq.getOrDefault(ch, 0) + 1);
        }
        for (char ch : s.toCharArray()) {
            if (freq.get(ch) == 1) {
                return ch;
            }
        }
        return null;
    }

    public static void main(String[] args) {
        // Driver the platform can inject per testcase
        // e.g., read string, call firstNonRepeatingChar, then print result
        java.util.Scanner scanner = new java.util.Scanner(System.in);
        while (scanner.hasNextLine()) {
            String line = scanner.nextLine().trim();
            if (line.isEmpty()) continue;
            Character result = firstNonRepeatingChar(line);
            if (result != null) {
                System.out.println(result);
            }
        }
    }
}
