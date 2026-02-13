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

    return '#'; // if no non-repeating character
}
