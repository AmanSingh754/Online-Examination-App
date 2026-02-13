#include <bits/stdc++.h>
using namespace std;

char firstNonRepeatingChar(string str) {

    unordered_map<char, int> count;

    for(char c : str){
        count[c]++;
    }

    for(char c : str){
        if(count[c] == 1){
            return c;
        }
    }

    return '#';
}

int main() {

    string str;
    getline(cin, str);   // ⭐ BETTER than cin

    char result = firstNonRepeatingChar(str);

    cout << result;

    return 0;
}
