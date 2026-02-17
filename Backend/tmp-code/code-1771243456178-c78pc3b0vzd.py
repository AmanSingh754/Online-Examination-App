def sum_with_reverse(num):
    reverse_num = int(str(num)[::-1])
    return num + reverse_num
 
n = int(input())
print(sum_with_reverse(n))