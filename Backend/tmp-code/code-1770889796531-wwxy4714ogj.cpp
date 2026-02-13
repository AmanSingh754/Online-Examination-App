#include <bits/stdc++.h>
using namespace std;

// Student will write this function
char firstNonRepeatingChar(string str) {

    unordered_map<char, int> count;

    // Count frequency
    for(char c : str){
        count[c]++;
    }

    // Find first non-repeating character
    for(char c : str){
        if(count[c] == 1){
            return c;
        }
    }

    return '#'; // If none found
}


// Backend / Driver Code (LOCK THIS)
int main() {

    string str;
    cin >> str;   // takes user input

    char result = firstNonRepeatingChar(str);

    cout << result;

    return 0;
}
